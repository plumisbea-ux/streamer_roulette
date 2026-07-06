import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Wheel } from './components/Wheel';
import { formatMoney, formatVotes, makeId, normalizeName, parseChannelId, pickWeightedPosition, platformLabel, cleanLabel } from './lib/helpers';
import { asDonation, decodeSSapiPayload, platformMatches } from './lib/ssapi';
import { SSAPI_API_KEY } from './lib/ssapiKey';
import { clearChannelState, loadChannelState, loadLastConfig, saveChannelState, saveLastConfig } from './lib/storage';
import type { ChannelConfig, ConnectionStatus, DonationLog, RouletteItem, SavedChannelState } from './types';

const SOCKET_URL = 'https://socket.ssapi.kr';
const MAX_LOGS = 100;
const MAX_PROCESSED_IDS = 3000;
const SPIN_DURATION_MS = 7700;
const TICK_START_MS = 3500;
const TICK_INTERVALS_MS = [60, 65, 70, 75, 82, 90, 100, 112, 126, 142, 160, 180, 205, 235, 270, 310, 355, 405, 465, 535];

type GuideModalProps = { onClose: () => void };

function GuideModal({ onClose }: GuideModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">사용 방법</p>
            <h2 id="guide-title">방송 전 설정</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="사용 설명서 닫기">×</button>
        </div>
        <ol className="guide-list">
          <li><strong>SSAPI에서 채널을 먼저 등록합니다.</strong><span>이 웹앱은 등록된 채널의 후원 이벤트를 SSAPI 소켓으로 읽습니다.</span></li>
          <li><strong>플랫폼, 채널 ID, 1표당 금액을 입력합니다.</strong><span>치지직은 방송 URL을 붙여 넣어도 됩니다.</span></li>
          <li><strong>방송 설정 적용 후 후원 수신 시작을 누릅니다.</strong><span>상태가 “후원 읽기 중”이면 준비가 끝난 것입니다.</span></li>
          <li><strong>후원 메시지가 선택지 이름이 됩니다.</strong><span>후원금 ÷ 1표당 금액의 몫만큼 표가 쌓입니다.</span></li>
          <li><strong>표는 오른쪽 목록에서 직접 수정할 수 있습니다.</strong><span>− / 숫자 입력 / + 버튼으로 조정하고, 삭제 버튼으로 항목을 지웁니다.</span></li>
        </ol>
        <div className="modal-footer">
          <a href="https://dashboard.ssapi.kr" target="_blank" rel="noreferrer">SSAPI 대시보드 열기</a>
          <button className="button primary" type="button" onClick={onClose}>확인</button>
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: ConnectionStatus): string {
  if (status === 'connecting') return '연결 중';
  if (status === 'reading') return '후원 읽기 중';
  if (status === 'error') return '연결 오류';
  return '대기 중';
}

function emptyState(): SavedChannelState {
  return { version: 1, items: [], donationLogs: [], processedDonationIds: [], updatedAt: Date.now() };
}

export default function App() {
  const initialConfig = useMemo(() => loadLastConfig(), []);
  const initialState = useMemo(() => loadChannelState(initialConfig), [initialConfig]);
  const [draft, setDraft] = useState<ChannelConfig>(initialConfig);
  const [activeConfig, setActiveConfig] = useState<ChannelConfig>(initialConfig);
  const [items, setItems] = useState<RouletteItem[]>(initialState.items);
  const [donationLogs, setDonationLogs] = useState<DonationLog[]>(initialState.donationLogs);
  const [processedIds, setProcessedIds] = useState<string[]>(initialState.processedDonationIds);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionNote, setConnectionNote] = useState('방송 설정을 적용한 뒤 후원 수신을 시작하세요.');
  const [manualName, setManualName] = useState('');
  const [manualVotes, setManualVotes] = useState('1');
  const [guideOpen, setGuideOpen] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<RouletteItem | null>(null);
  const [tickId, setTickId] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const spinTimerRef = useRef<number | null>(null);
  const tickTimerRefs = useRef<number[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processedIdSetRef = useRef<Set<string>>(new Set(initialState.processedDonationIds));
  const activeConfigRef = useRef(activeConfig);
  const voteUnitRef = useRef(activeConfig.voteUnitPrice);
  const connectionStatusRef = useRef(connectionStatus);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt),
    [items],
  );
  const totalVotes = useMemo(() => items.reduce((sum, item) => sum + item.votes, 0), [items]);

  useEffect(() => {
    activeConfigRef.current = activeConfig;
    voteUnitRef.current = activeConfig.voteUnitPrice;
  }, [activeConfig]);

  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  useEffect(() => {
    processedIdSetRef.current = new Set(processedIds);
  }, [processedIds]);

  useEffect(() => {
    saveChannelState(activeConfig, {
      version: 1,
      items,
      donationLogs,
      processedDonationIds: processedIds,
      updatedAt: Date.now(),
    });
  }, [activeConfig, donationLogs, items, processedIds]);

  useEffect(() => {
    return () => {
      disconnectSocket(false);
      if (spinTimerRef.current !== null) window.clearTimeout(spinTimerRef.current);
      clearTickTimers();
      if (audioContextRef.current) void audioContextRef.current.close();
    };
  }, []);

  function disconnectSocket(updateUi = true): void {
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (updateUi) {
      setConnectionStatus('idle');
      setConnectionNote('후원 수신을 중단했습니다.');
    }
  }

  function loadForConfig(config: ChannelConfig): void {
    const state = config.channelId ? loadChannelState(config) : emptyState();
    processedIdSetRef.current = new Set(state.processedDonationIds);
    setItems(state.items);
    setDonationLogs(state.donationLogs);
    setProcessedIds(state.processedDonationIds);
  }

  function applyConfig(): void {
    const next: ChannelConfig = {
      platform: draft.platform,
      channelId: parseChannelId(draft.channelId),
      voteUnitPrice: Math.max(1, Math.floor(Number(draft.voteUnitPrice) || 0)),
    };
    if (!next.channelId) {
      window.alert('채널 ID 또는 방송 URL을 입력하세요.');
      return;
    }
    if (!next.voteUnitPrice) {
      window.alert('1표당 금액은 1원 이상이어야 합니다.');
      return;
    }

    const changed = next.platform !== activeConfig.platform || next.channelId !== activeConfig.channelId;
    if (connectionStatus === 'reading' || connectionStatus === 'connecting') disconnectSocket(false);
    setDraft(next);
    setActiveConfig(next);
    saveLastConfig(next);
    if (changed) loadForConfig(next);
    setConnectionStatus('idle');
    setConnectionNote(changed ? '새 채널 설정을 적용했습니다.' : '방송 설정을 적용했습니다.');
  }

  function addVotes(optionName: string, votes: number, log: Omit<DonationLog, 'id' | 'receivedAt' | 'addedVotes' | 'message'> & { message?: string }): void {
    const label = cleanLabel(optionName);
    const id = normalizeName(label);
    const safeVotes = Math.max(0, Math.floor(votes));
    if (!id || safeVotes <= 0) return;

    const now = Date.now();
    setItems((previous) => {
      const existing = previous.find((item) => item.id === id);
      if (existing) {
        return previous.map((item) => item.id === id ? { ...item, votes: item.votes + safeVotes, updatedAt: now } : item);
      }
      return [...previous, { id, label, votes: safeVotes, createdAt: now, updatedAt: now }];
    });
    const nextLog: DonationLog = {
      id: makeId(log.source),
      nickname: log.nickname,
      message: log.message ?? label,
      amount: Math.max(0, log.amount),
      addedVotes: safeVotes,
      receivedAt: now,
      source: log.source,
    };

    setDonationLogs((previous) => [nextLog, ...previous].slice(0, MAX_LOGS));
  }

  function onDonation(payload: unknown): void {
    const donation = asDonation(payload);
    if (!donation) return;

    const config = activeConfigRef.current;
    if (!platformMatches(config.platform, donation.platform) || String(donation.streamer_id ?? '') !== config.channelId) return;

    const donationId = donation._id ? String(donation._id) : '';
    if (donationId && processedIdSetRef.current.has(donationId)) return;
    if (donationId) {
      processedIdSetRef.current.add(donationId);
      setProcessedIds((previous) => [...previous, donationId].slice(-MAX_PROCESSED_IDS));
    }

    const message = cleanLabel(String(donation.message ?? ''));
    const amount = Math.max(0, Number(donation.amount ?? 0));
    const votes = Math.floor(amount / Math.max(1, voteUnitRef.current));
    const nickname = String(donation.nickname ?? '익명');

    if (!message || votes <= 0) {
      const ignoredLog: DonationLog = {
        id: donationId || makeId('donation'),
        nickname,
        message: message || '(메시지 없음)',
        amount,
        addedVotes: 0,
        receivedAt: Date.now(),
        source: 'donation',
      };
      setDonationLogs((previous) => [ignoredLog, ...previous].slice(0, MAX_LOGS));
      return;
    }

    addVotes(message, votes, { nickname, amount, source: 'donation', message });
  }

  function startReading(): void {
    if (connectionStatus === 'reading' || connectionStatus === 'connecting') {
      disconnectSocket();
      return;
    }
    if (!activeConfig.channelId || activeConfig.voteUnitPrice <= 0) {
      window.alert('먼저 플랫폼, 채널 ID, 1표당 금액을 입력하고 방송 설정을 적용하세요.');
      return;
    }

    setConnectionStatus('connecting');
    setConnectionNote('SSAPI에 연결하고 있습니다…');

    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    let loginHandled = false;
    const handleLogin = (raw: unknown): void => {
      if (loginHandled) return;
      loginHandled = true;
      const room = decodeSSapiPayload(raw) as { error?: number; users?: Array<{ platform?: string; streamer_id?: string }> } | undefined;
      if (room && typeof room === 'object' && room.error !== undefined && Number(room.error) !== 0) {
        setConnectionStatus('error');
        setConnectionNote(`SSAPI 로그인에 실패했습니다. (error ${room.error})`);
        socket.disconnect();
        return;
      }

      socket.emit('setReceiver', 'donation');
      const current = activeConfigRef.current;
      const registered = Array.isArray(room?.users) && room.users.some((user) => platformMatches(current.platform, user.platform) && String(user.streamer_id ?? '') === current.channelId);
      setConnectionStatus('reading');
      setConnectionNote(registered ? '후원 읽기 중입니다. 이후 들어온 후원이 표에 반영됩니다.' : '후원 읽기 중입니다. SSAPI 대시보드에서 해당 채널이 등록되어 있는지 확인하세요.');
    };

    socket.on('connect', () => {
      setConnectionNote('연결됨. 후원 수신을 준비하고 있습니다…');
      socket.emit('login', SSAPI_API_KEY, (reply: unknown) => handleLogin(reply));
    });
    socket.on('login', handleLogin);
    socket.on('receiver', () => setConnectionStatus('reading'));
    socket.on('donation', onDonation);
    socket.on('connect_error', (error) => {
      setConnectionStatus('error');
      setConnectionNote(`연결 실패: ${error.message || '네트워크를 확인하세요.'}`);
    });
    socket.on('disconnect', (reason) => {
      if (socketRef.current !== socket) return;
      if (connectionStatusRef.current !== 'idle') {
        setConnectionStatus('idle');
        setConnectionNote(`연결이 종료되었습니다: ${reason}`);
      }
    });

    pingTimerRef.current = window.setInterval(() => {
      if (socket.connected) socket.emit('ping');
    }, 60_000);
  }

  function handleManualAdd(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const votes = Math.floor(Number(manualVotes));
    if (!manualName.trim()) {
      window.alert('선택지 이름을 입력하세요.');
      return;
    }
    if (!Number.isFinite(votes) || votes <= 0) {
      window.alert('표 수는 1 이상이어야 합니다.');
      return;
    }
    addVotes(manualName, votes, { nickname: '수동 추가', amount: 0, source: 'manual' });
    setManualName('');
    setManualVotes('1');
  }

  function setItemVotes(id: string, value: number): void {
    const votes = Math.max(0, Math.floor(value || 0));
    setItems((previous) => previous
      .map((item) => item.id === id ? { ...item, votes, updatedAt: Date.now() } : item)
      .filter((item) => item.votes > 0));
  }

  function adjustItem(id: string, delta: number): void {
    const target = items.find((item) => item.id === id);
    if (!target) return;
    setItemVotes(id, target.votes + delta);
  }

  function deleteItem(id: string): void {
    const target = items.find((item) => item.id === id);
    if (!target || !window.confirm(`“${target.label}” 항목을 삭제할까요?`)) return;
    setItems((previous) => previous.filter((item) => item.id !== id));
  }

  function resetChannel(): void {
    if (!activeConfig.channelId) return;
    if (!window.confirm('현재 채널의 룰렛 표와 최근 내역을 모두 초기화할까요?')) return;
    disconnectSocket(false);
    clearChannelState(activeConfig);
    setItems([]);
    setDonationLogs([]);
    setProcessedIds([]);
    processedIdSetRef.current = new Set();
    setConnectionStatus('idle');
    setConnectionNote('현재 채널의 데이터를 초기화했습니다.');
  }

  function clearTickTimers(): void {
    tickTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    tickTimerRefs.current = [];
  }

  function prepareTickAudio(): void {
    try {
      const audioContext = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') void audioContext.resume();
    } catch {
      // 소리를 낼 수 없는 환경에서는 시각 효과만 적용합니다.
    }
  }

  function playTickSound(index: number): void {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;

    try {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(820 - Math.min(170, index * 7), now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.028, now + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.045);
    } catch {
      // 브라우저의 오디오 정책으로 막히면 시각 효과만 유지합니다.
    }
  }

  function startTickSequence(): void {
    clearTickTimers();
    let elapsed = TICK_START_MS;

    TICK_INTERVALS_MS.forEach((delay, index) => {
      elapsed += delay;
      const timer = window.setTimeout(() => {
        setTickId((previous) => previous + 1);
        playTickSound(index);
      }, elapsed);
      tickTimerRefs.current.push(timer);
    });
  }

  function spin(): void {
    // 룰렛에 보이는 순서와 동일한 배열로 추첨해야, 포인터 위치와 결과 팝업이 항상 일치합니다.
    const snapshot = sortedItems.filter((item) => item.votes > 0);
    const picked = pickWeightedPosition(snapshot);
    if (!picked || spinning) {
      if (!spinning) window.alert('룰렛을 돌릴 선택지가 없습니다.');
      return;
    }

    const { winner, targetAngle } = picked;
    setResult(null);
    prepareTickAudio();
    startTickSequence();
    setSpinning(true);
    setRotation((previous) => {
      const current = ((previous % 360) + 360) % 360;
      // 포인터가 12시 방향에 있으므로, 당첨 구역 안에서 무작위로 뽑힌 각도를 포인터 아래로 보냅니다.
      const correction = (360 - targetAngle - current + 360) % 360;
      return previous + 360 * 10 + correction;
    });

    if (spinTimerRef.current !== null) window.clearTimeout(spinTimerRef.current);
    spinTimerRef.current = window.setTimeout(() => {
      clearTickTimers();
      setSpinning(false);
      setResult(winner);
      spinTimerRef.current = null;
    }, SPIN_DURATION_MS);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">STREAM TOOL</p>
          <h1>후원 룰렛</h1>
        </div>
        <div className="topbar-actions">
          <button className="button secondary" type="button" onClick={() => setGuideOpen(true)}>사용 설명서</button>
          <div className={`status ${connectionStatus}`} title={connectionNote}>
            <span aria-hidden="true" />{statusLabel(connectionStatus)}
          </div>
        </div>
      </header>

      <section className="settings-panel" aria-labelledby="settings-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">방송 설정</p>
            <h2 id="settings-heading">채널 연결</h2>
          </div>
          <button className="text-button danger" type="button" onClick={resetChannel} disabled={!activeConfig.channelId}>현재 데이터 초기화</button>
        </div>
        <div className="settings-grid">
          <label>
            <span>플랫폼</span>
            <select value={draft.platform} onChange={(event) => setDraft((previous) => ({ ...previous, platform: event.target.value as ChannelConfig['platform'] }))}>
              <option value="chzzk">치지직</option>
              <option value="soop">숲</option>
            </select>
          </label>
          <label className="wide">
            <span>채널 ID 또는 방송 URL</span>
            <input value={draft.channelId} onChange={(event) => setDraft((previous) => ({ ...previous, channelId: event.target.value }))} placeholder="채널 ID 또는 방송 URL" autoComplete="off" />
          </label>
          <label>
            <span>1표당 금액</span>
            <div className="input-suffix"><input type="number" min="1" value={draft.voteUnitPrice} onChange={(event) => setDraft((previous) => ({ ...previous, voteUnitPrice: Number(event.target.value) }))} /><em>원</em></div>
          </label>
          <button className="button primary apply-button" type="button" onClick={applyConfig}>설정 적용</button>
        </div>
        <p className="muted-note">{activeConfig.channelId ? `${platformLabel(activeConfig.platform)} · ${activeConfig.channelId} · 1표 ${formatMoney(activeConfig.voteUnitPrice)}` : '채널 ID와 표 단가를 입력하세요.'}</p>
      </section>

      <section className="receive-panel" aria-label="후원 수신 제어">
        <div>
          <p className="eyebrow">SSAPI 후원 수신</p>
          <h2>{connectionStatus === 'reading' ? '후원을 읽는 중입니다' : '후원 수신 준비'}</h2>
          <p>{connectionNote}</p>
        </div>
        <button className={`button ${connectionStatus === 'reading' || connectionStatus === 'connecting' ? 'secondary' : 'primary'}`} type="button" onClick={startReading}>
          {connectionStatus === 'reading' || connectionStatus === 'connecting' ? '후원 수신 중단' : '후원 수신 시작'}
        </button>
      </section>

      <div className="content-grid">
        <section className="wheel-panel" aria-labelledby="wheel-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">가중치 룰렛</p>
              <h2 id="wheel-heading">현재 표 {formatVotes(totalVotes)}</h2>
            </div>
            <button className="button primary" type="button" onClick={spin} disabled={spinning}>{spinning ? '운명 결정 중…' : '룰렛 돌리기'}</button>
          </div>
          <Wheel items={sortedItems} rotation={rotation} spinning={spinning} tickId={tickId} />
          <p className="muted-note">표 비율에 따라 룰렛 칸의 크기와 당첨 확률이 달라집니다.</p>
        </section>

        <section className="ranking-panel" aria-labelledby="rank-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">실시간 순위</p>
              <h2 id="rank-heading">선택지 {sortedItems.length}개</h2>
            </div>
          </div>
          <div className="rank-table-wrap">
            <table className="rank-table">
              <thead><tr><th>#</th><th>선택지</th><th>표 수</th><th>관리</th></tr></thead>
              <tbody>
                {sortedItems.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td className="option-name">{item.label}</td>
                    <td>
                      <div className="vote-editor">
                        <button type="button" aria-label={`${item.label} 표 1 감소`} onClick={() => adjustItem(item.id, -1)}>−</button>
                        <input type="number" min="1" value={item.votes} onChange={(event) => setItemVotes(item.id, Number(event.target.value))} aria-label={`${item.label} 표 수`} />
                        <button type="button" aria-label={`${item.label} 표 1 증가`} onClick={() => adjustItem(item.id, 1)}>+</button>
                      </div>
                    </td>
                    <td><button className="text-button danger" type="button" onClick={() => deleteItem(item.id)}>삭제</button></td>
                  </tr>
                ))}
                {!sortedItems.length && <tr><td colSpan={4} className="empty-cell">아직 선택지가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="bottom-grid">
        <section className="manual-panel" aria-labelledby="manual-heading">
          <div className="section-heading">
            <div><p className="eyebrow">수동 추가</p><h2 id="manual-heading">직접 표 넣기</h2></div>
          </div>
          <form className="manual-form" onSubmit={handleManualAdd}>
            <input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="선택지 이름" />
            <input value={manualVotes} onChange={(event) => setManualVotes(event.target.value)} type="number" min="1" aria-label="표 수" />
            <button className="button primary" type="submit">추가</button>
          </form>
          <p className="muted-note">공백과 기호를 제외한 이름이 같으면 같은 항목으로 합산됩니다.</p>
        </section>

        <section className="history-panel" aria-labelledby="history-heading">
          <div className="section-heading"><div><p className="eyebrow">최근 반영</p><h2 id="history-heading">내역 {donationLogs.length}건</h2></div></div>
          <ul className="history-list">
            {donationLogs.slice(0, 8).map((log) => (
              <li key={log.id}>
                <div><strong>{log.message}</strong><span>{log.source === 'manual' ? '수동 추가' : log.nickname}</span></div>
                <div className="history-result"><span>{log.source === 'donation' ? formatMoney(log.amount) : '직접 입력'}</span><strong>+{formatVotes(log.addedVotes)}</strong></div>
              </li>
            ))}
            {!donationLogs.length && <li className="empty-history">아직 반영된 내역이 없습니다.</li>}
          </ul>
        </section>
      </div>

      {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} />}
      {result && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setResult(null)}>
          <section className="modal result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="result-confetti" aria-hidden="true">
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
            </div>
            <div className="result-badge" aria-hidden="true">★</div>
            <p className="eyebrow">당첨 선택지</p>
            <h2 id="result-title">{result.label}</h2>
            <p className="result-votes">{formatVotes(result.votes)}</p>
            <p className="result-copy">오늘의 운명이 선택되었습니다.</p>
            <button className="button primary" type="button" onClick={() => setResult(null)}>확인</button>
          </section>
        </div>
      )}
    </main>
  );
}
