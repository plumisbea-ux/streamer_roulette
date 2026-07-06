import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { RouletteWheel } from './components/RouletteWheel';
import { RankList } from './components/RankList';
import { asDonation, decodeSSapiPayload, platformMatches } from './lib/ssapi';
import { cleanDisplayLabel, formatVotes, formatWon, normalizeOptionName, parseChannelId, platformLabel, shortChannelId } from './lib/text';
import {
  clearChannelState,
  loadChannelState,
  loadLastConfig,
  loadSavedApiKey,
  removeSavedApiKey,
  saveApiKey,
  saveChannelState,
  saveLastConfig,
} from './lib/storage';
import type { ChannelConfig, ConnectionStatus, DonationLog, RouletteItem, SavedChannelState, SpinPlan } from './types';

const SOCKET_URL = 'https://socket.ssapi.kr';
const MAX_LOGS = 100;
const MAX_PROCESSED_IDS = 3000;

function makeLocalId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function pickWeighted(items: RouletteItem[]) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.votes), 0);
  let point = Math.random() * total;
  for (const item of items) {
    point -= item.votes;
    if (point < 0) return item;
  }
  return items.at(-1) ?? null;
}

function isConfigured(config: ChannelConfig) {
  return Boolean(config.channelId.trim() && config.voteUnitPrice > 0);
}

function statusText(status: ConnectionStatus) {
  if (status === 'connecting') return '연결 중…';
  if (status === 'reading') return '후원 읽기 중';
  if (status === 'error') return '연결 오류';
  return '후원 읽기 대기';
}

export default function App() {
  const initialConfig = useMemo(() => loadLastConfig(), []);
  const initialState = useMemo(() => loadChannelState(initialConfig), [initialConfig]);

  const [draft, setDraft] = useState<ChannelConfig>(initialConfig);
  const [activeConfig, setActiveConfig] = useState<ChannelConfig>(initialConfig);
  const [apiKey, setApiKey] = useState(() => loadSavedApiKey());
  const [saveKeyOnDevice, setSaveKeyOnDevice] = useState(() => Boolean(loadSavedApiKey()));
  const [items, setItems] = useState<RouletteItem[]>(initialState.items);
  const [donationLogs, setDonationLogs] = useState<DonationLog[]>(initialState.donationLogs);
  const [processedDonationIds, setProcessedDonationIds] = useState<string[]>(initialState.processedDonationIds);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionNote, setConnectionNote] = useState('방송 설정을 적용한 뒤 후원 읽기를 시작하세요.');
  const [manualName, setManualName] = useState('');
  const [manualVotes, setManualVotes] = useState('1');
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeText, setChallengeText] = useState('');
  const [spinPlan, setSpinPlan] = useState<SpinPlan | null>(null);
  const [winner, setWinner] = useState<RouletteItem | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);

  const socketRef = useRef<Socket | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const processedIdSetRef = useRef(new Set<string>(initialState.processedDonationIds));
  const activeConfigRef = useRef(activeConfig);
  const voteUnitRef = useRef(activeConfig.voteUnitPrice);
  const spinSequenceRef = useRef(0);
  const loginHandledRef = useRef(false);
  const connectionStatusRef = useRef<ConnectionStatus>('idle');

  useEffect(() => { activeConfigRef.current = activeConfig; voteUnitRef.current = activeConfig.voteUnitPrice; }, [activeConfig]);
  useEffect(() => { connectionStatusRef.current = connectionStatus; }, [connectionStatus]);
  useEffect(() => { processedIdSetRef.current = new Set(processedDonationIds); }, [processedDonationIds]);
  useEffect(() => { setImageFailed(false); }, [activeConfig.imageUrl, activeConfig.channelId]);

  useEffect(() => {
    const state: SavedChannelState = {
      version: 1,
      items,
      donationLogs,
      processedDonationIds,
      updatedAt: Date.now(),
    };
    saveChannelState(activeConfig, state);
  }, [activeConfig, items, donationLogs, processedDonationIds]);

  useEffect(() => () => disconnectSocket(false), []);

  function disconnectSocket(updateUi = true) {
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    loginHandledRef.current = false;
    if (updateUi) {
      setConnectionStatus('idle');
      setConnectionNote('후원 읽기가 중단되었습니다.');
    }
  }

  function loadForConfig(config: ChannelConfig) {
    const saved = loadChannelState(config);
    processedIdSetRef.current = new Set(saved.processedDonationIds);
    setItems(saved.items);
    setDonationLogs(saved.donationLogs);
    setProcessedDonationIds(saved.processedDonationIds);
  }

  function applyConfig() {
    const config: ChannelConfig = {
      ...draft,
      channelId: parseChannelId(draft.channelId),
      displayName: cleanDisplayLabel(draft.displayName),
      imageUrl: draft.imageUrl.trim(),
      voteUnitPrice: Math.max(1, Math.floor(Number(draft.voteUnitPrice) || 0)),
    };

    if (!config.channelId) {
      window.alert('채널 ID 또는 방송 URL을 입력하세요.');
      return;
    }
    if (!config.voteUnitPrice) {
      window.alert('1표당 금액은 1원 이상으로 입력하세요.');
      return;
    }

    const changed = config.platform !== activeConfig.platform || config.channelId !== activeConfig.channelId;
    if (connectionStatus === 'reading' || connectionStatus === 'connecting') disconnectSocket(false);

    setDraft(config);
    setActiveConfig(config);
    saveLastConfig(config);
    if (changed) loadForConfig(config);
    setConnectionStatus('idle');
    setConnectionNote(changed ? '새 채널 설정을 적용했습니다. 저장된 룰렛 상태를 불러왔어요.' : '설정을 적용했습니다.');
  }

  function addVotes(optionName: string, votes: number, log: Omit<DonationLog, 'id' | 'receivedAt' | 'message' | 'addedVotes'> & { message?: string; source: 'donation' | 'manual' }) {
    const label = cleanDisplayLabel(optionName);
    const key = normalizeOptionName(label);
    const amount = Math.max(0, Math.floor(log.amount));
    const safeVotes = Math.max(0, Math.floor(votes));
    if (!key || safeVotes <= 0) return;

    const now = Date.now();
    setItems((previous) => {
      const existing = previous.find((item) => item.id === key);
      if (existing) {
        return previous.map((item) => item.id === key ? { ...item, votes: item.votes + safeVotes, updatedAt: now } : item);
      }
      return [...previous, { id: key, label, votes: safeVotes, createdAt: now, updatedAt: now }];
    });

    setDonationLogs((previous) => [{
      id: makeLocalId(log.source),
      nickname: log.nickname,
      message: log.message ?? label,
      amount,
      addedVotes: safeVotes,
      receivedAt: now,
      source: log.source,
    }, ...previous].slice(0, MAX_LOGS));
  }

  function onDonation(payload: unknown) {
    const donation = asDonation(payload);
    if (!donation) return;

    const config = activeConfigRef.current;
    const incomingId = donation._id ? String(donation._id) : '';
    const sameStream = platformMatches(config.platform, donation.platform) && String(donation.streamer_id ?? '') === config.channelId;
    if (!sameStream) return;

    if (incomingId && processedIdSetRef.current.has(incomingId)) return;
    if (incomingId) {
      processedIdSetRef.current.add(incomingId);
      setProcessedDonationIds((previous) => [...previous, incomingId].slice(-MAX_PROCESSED_IDS));
    }

    const message = cleanDisplayLabel(String(donation.message ?? ''));
    const amount = Math.max(0, Number(donation.amount ?? 0));
    const votes = Math.floor(amount / Math.max(1, voteUnitRef.current));

    if (!message) {
      setDonationLogs((previous) => [{
        id: incomingId || makeLocalId('donation'),
        nickname: String(donation.nickname ?? '익명'),
        message: '(메시지 없음)',
        amount,
        addedVotes: 0,
        receivedAt: Date.now(),
        source: 'donation' as const,
      }, ...previous].slice(0, MAX_LOGS));
      return;
    }

    if (votes <= 0) {
      setDonationLogs((previous) => [{
        id: incomingId || makeLocalId('donation'),
        nickname: String(donation.nickname ?? '익명'),
        message,
        amount,
        addedVotes: 0,
        receivedAt: Date.now(),
        source: 'donation' as const,
      }, ...previous].slice(0, MAX_LOGS));
      return;
    }

    addVotes(message, votes, {
      nickname: String(donation.nickname ?? '익명'),
      amount,
      source: 'donation',
      message,
    });
  }

  function handleStartReading() {
    if (connectionStatus === 'reading' || connectionStatus === 'connecting') {
      disconnectSocket(true);
      return;
    }

    if (!isConfigured(activeConfig)) {
      window.alert('먼저 플랫폼·채널 ID·1표당 금액을 입력하고 “방송 설정 적용”을 누르세요.');
      return;
    }
    if (!apiKey.trim()) {
      window.alert('SSAPI API 키를 입력하세요.');
      return;
    }

    if (saveKeyOnDevice) saveApiKey(apiKey.trim());
    else removeSavedApiKey();

    setConnectionStatus('connecting');
    setConnectionNote('SSAPI 소켓에 연결하고 있습니다…');
    loginHandledRef.current = false;

    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    const handleLogin = (raw: unknown) => {
      if (loginHandledRef.current) return;
      loginHandledRef.current = true;
      const room = decodeSSapiPayload(raw) as { error?: number; users?: Array<{ platform?: string; streamer_id?: string }> } | undefined;
      if (room && typeof room === 'object' && Number(room.error) !== 0 && room.error !== undefined) {
        setConnectionStatus('error');
        setConnectionNote(`SSAPI 로그인 실패 (error ${room.error}). API 키를 확인하세요.`);
        socket.disconnect();
        return;
      }

      const current = activeConfigRef.current;
      const registered = Array.isArray(room?.users) && room!.users.some((user) => (
        platformMatches(current.platform, user.platform) && String(user.streamer_id ?? '') === current.channelId
      ));

      socket.emit('setReceiver', 'donation');
      setConnectionStatus('reading');
      setConnectionNote(registered
        ? '후원 읽기 중입니다. 이 시점 이후의 후원만 룰렛에 반영됩니다.'
        : '후원 읽기 중입니다. 단, SSAPI 대시보드에서 이 채널을 같은 API 키의 룸에 등록했는지 확인하세요.');
    };

    socket.on('connect', () => {
      setConnectionNote('연결됨. SSAPI 로그인 중…');
      socket.emit('login', apiKey.trim(), (reply: unknown) => handleLogin(reply));
    });
    socket.on('login', handleLogin);
    socket.on('receiver', () => {
      setConnectionStatus('reading');
    });
    socket.on('donation', onDonation);
    socket.on('connect_error', (error) => {
      setConnectionStatus('error');
      setConnectionNote(`연결 실패: ${error.message || '네트워크 또는 API 키 상태를 확인하세요.'}`);
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

  function handleManualAdd(event: FormEvent) {
    event.preventDefault();
    const votes = Math.floor(Number(manualVotes));
    if (!manualName.trim()) {
      window.alert('추가할 선택지 이름을 입력하세요.');
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

  function adjustItem(id: string, delta: number) {
    setItems((previous) => previous
      .map((item) => item.id === id ? { ...item, votes: Math.max(0, item.votes + delta), updatedAt: Date.now() } : item)
      .filter((item) => item.votes > 0));
  }

  function deleteItem(id: string) {
    const target = items.find((item) => item.id === id);
    if (!target) return;
    if (!window.confirm(`“${target.label}” 항목을 삭제할까요?`)) return;
    setItems((previous) => previous.filter((item) => item.id !== id));
  }

  function resetCurrentChannel() {
    if (!activeConfig.channelId) return;
    if (!window.confirm('현재 채널의 룰렛 항목·후원 로그·중복 방지 기록을 모두 삭제할까요?')) return;
    disconnectSocket(false);
    clearChannelState(activeConfig);
    processedIdSetRef.current = new Set();
    setItems([]);
    setDonationLogs([]);
    setProcessedDonationIds([]);
    setConnectionStatus('idle');
    setConnectionNote('현재 채널의 로컬 룰렛 데이터를 초기화했습니다.');
  }

  function openChallenge() {
    if (!items.some((item) => item.votes > 0)) {
      window.alert('룰렛을 돌릴 선택지가 없습니다.');
      return;
    }
    if (spinPlan) return;
    setChallengeText('');
    setChallengeOpen(true);
  }

  function startSpin() {
    if (challengeText.trim() !== '도전!') return;
    const snapshot = items.filter((item) => item.votes > 0).map((item) => ({ ...item }));
    const selected = pickWeighted(snapshot);
    if (!selected) return;
    setWinner(null);
    setChallengeOpen(false);
    setSpinPlan({ id: ++spinSequenceRef.current, items: snapshot, winnerId: selected.id });
  }

  function finishSpin(winnerId: string) {
    const selected = spinPlan?.items.find((item) => item.id === winnerId) ?? null;
    setWinner(selected);
    setSpinPlan(null);
  }

  const sortedItems = useMemo(() => [...items].sort((a, b) => (b.votes - a.votes) || (a.createdAt - b.createdAt)), [items]);
  const totalVotes = useMemo(() => items.reduce((sum, item) => sum + item.votes, 0), [items]);
  const effectiveName = activeConfig.displayName || shortChannelId(activeConfig.channelId);
  const wheelItems = spinPlan?.items ?? sortedItems;

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">LOCAL STREAM TOOL · NO PRIVATE SERVER</p>
          <h1>후원 룰렛</h1>
          <p className="hero-copy">후원 메시지를 표로 바꾸고, 실시간 순위와 가중치 룰렛으로 진행하세요.</p>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="guide-toggle"
            aria-expanded={guideOpen}
            aria-controls="quick-start-guide"
            onClick={() => setGuideOpen((open) => !open)}
          >
            {guideOpen ? '처음 사용 안내 접기' : '처음 사용 안내'}
          </button>
          <div className={`status-pill ${connectionStatus}`}>
            <span className="status-dot" />
            {statusText(connectionStatus)}
          </div>
        </div>
      </header>

      {guideOpen && (
        <section className="panel quick-guide" id="quick-start-guide" aria-labelledby="quick-start-title">
          <div className="guide-heading">
            <div>
              <p className="section-kicker">START HERE · 처음 한 번만 설정</p>
              <h2 id="quick-start-title">처음 사용하시나요? 아래 순서대로 하면 됩니다.</h2>
              <p>이 앱은 치지직·숲 공식 API 대신 <strong>SSAPI 후원 소켓</strong>을 사용합니다. 그래서 방송 시작 전에 SSAPI에서 내 채널을 한 번 등록해야 합니다.</p>
            </div>
            <a className="external-link guide-dashboard-link" href="https://dashboard.ssapi.kr" target="_blank" rel="noreferrer">SSAPI 대시보드 열기 ↗</a>
          </div>

          <ol className="guide-steps">
            <li>
              <span className="guide-number">1</span>
              <div>
                <strong>SSAPI API 키를 발급하고 내 채널을 등록하세요.</strong>
                <p>SSAPI 대시보드에서 회원가입 후 API 키를 발급받고, <b>같은 API 키의 룸에 본인 방송 채널</b>을 등록합니다. 이 단계가 끝나야 후원 정보가 이 웹앱으로 들어옵니다.</p>
              </div>
            </li>
            <li>
              <span className="guide-number">2</span>
              <div>
                <strong>아래 ‘방송 설정’에 플랫폼·채널 ID·표 단가를 입력하세요.</strong>
                <p>치지직은 방송 URL을 그대로 붙여 넣어도 됩니다. <code>/live/</code> 뒤의 채널 ID를 자동으로 사용합니다. 표시 이름·대표 이미지 URL은 선택 사항입니다.</p>
              </div>
            </li>
            <li>
              <span className="guide-number">3</span>
              <div>
                <strong>SSAPI API 키를 넣고 ‘후원 읽기 시작’을 누르세요.</strong>
                <p>1번에서 채널을 등록할 때 사용한 <b>동일한 키</b>를 입력하세요. 상태가 ‘후원 읽기 중’으로 바뀌면, 그 시점 이후 후원이 자동으로 반영됩니다.</p>
              </div>
            </li>
            <li>
              <span className="guide-number">4</span>
              <div>
                <strong>후원 메시지는 선택지, 후원금은 표가 됩니다.</strong>
                <p>예: 1표당 1,000원일 때 ‘김치찌개’와 함께 5,000원을 후원하면 김치찌개에 5표가 쌓입니다. 먼저 아래 수동 추가로 룰렛이 잘 도는지 시험해 보세요.</p>
              </div>
            </li>
          </ol>

          <div className="guide-check">
            <strong>방송 시작 전 30초 점검</strong>
            <span>① SSAPI에 채널 등록 완료</span>
            <span>② 이 앱의 플랫폼·채널 ID 일치</span>
            <span>③ 표 단가 확인</span>
            <span>④ 수동 추가로 룰렛 테스트</span>
          </div>
        </section>
      )}

      <section className="panel setup-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">1. 방송 설정</p>
            <h2>채널을 연결할 준비</h2>
          </div>
          <button type="button" className="text-button" onClick={resetCurrentChannel}>현재 채널 데이터 초기화</button>
        </div>

        <div className="setup-grid">
          <label>
            <span>플랫폼</span>
            <select value={draft.platform} onChange={(event) => setDraft((previous) => ({ ...previous, platform: event.target.value as ChannelConfig['platform'] }))}>
              <option value="chzzk">치지직</option>
              <option value="soop">숲</option>
            </select>
          </label>
          <label className="wide-field">
            <span>채널 ID 또는 방송 URL</span>
            <input
              value={draft.channelId}
              onChange={(event) => setDraft((previous) => ({ ...previous, channelId: event.target.value }))}
              placeholder="치지직 /live/ 뒤 채널 ID 또는 URL"
              autoComplete="off"
            />
          </label>
          <label>
            <span>표시 이름 <em>선택</em></span>
            <input value={draft.displayName} onChange={(event) => setDraft((previous) => ({ ...previous, displayName: event.target.value }))} placeholder="예: 역덕후 방송" />
          </label>
          <label>
            <span>대표 이미지 URL <em>선택</em></span>
            <input value={draft.imageUrl} onChange={(event) => setDraft((previous) => ({ ...previous, imageUrl: event.target.value }))} placeholder="https://…" />
          </label>
          <label>
            <span>1표당 금액</span>
            <div className="number-unit"><input type="number" min="1" value={draft.voteUnitPrice} onChange={(event) => setDraft((previous) => ({ ...previous, voteUnitPrice: Number(event.target.value) }))} /><b>원</b></div>
          </label>
          <div className="apply-wrap">
            <button type="button" className="primary-btn" onClick={applyConfig}>방송 설정 적용</button>
          </div>
        </div>

        <div className="channel-card">
          <div className="channel-avatar">
            {activeConfig.imageUrl && !imageFailed ? <img src={activeConfig.imageUrl} alt="대표" onError={() => setImageFailed(true)} /> : <span>{platformLabel(activeConfig.platform).slice(0, 1)}</span>}
          </div>
          <div className="channel-meta">
            <strong>{effectiveName}</strong>
            <span>{platformLabel(activeConfig.platform)} · {shortChannelId(activeConfig.channelId)}</span>
          </div>
          <div className="channel-stat">
            <span>현재 표</span>
            <strong>{formatVotes(totalVotes)}</strong>
          </div>
        </div>
      </section>

      <section className="panel socket-panel">
        <div className="section-heading compact">
          <div>
            <p className="section-kicker">2. SSAPI 후원 수신</p>
            <h2>후원 읽기 제어</h2>
          </div>
          <a className="external-link" href="https://dashboard.ssapi.kr" target="_blank" rel="noreferrer">SSAPI 대시보드 열기 ↗</a>
        </div>
        <div className="socket-row">
          <label className="api-field">
            <span>SSAPI API 키</span>
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="이 브라우저에서만 사용" autoComplete="off" />
          </label>
          <label className="save-key-check"><input type="checkbox" checked={saveKeyOnDevice} onChange={(event) => setSaveKeyOnDevice(event.target.checked)} /> <span>이 기기에 저장</span></label>
          <button type="button" className={`reading-btn ${connectionStatus === 'reading' || connectionStatus === 'connecting' ? 'active' : ''}`} onClick={handleStartReading}>
            <span className="reading-icon">{connectionStatus === 'reading' || connectionStatus === 'connecting' ? '■' : '▶'}</span>
            {connectionStatus === 'reading' || connectionStatus === 'connecting' ? '후원 읽기 중단' : '후원 읽기 시작'}
          </button>
        </div>
        <p className={`connection-note ${connectionStatus}`}>{connectionNote}</p>
        <p className="small-note">이 버전은 치지직/숲 공식 API를 호출하지 않습니다. 표시 이름·대표 이미지는 직접 입력하며, 후원은 SSAPI에 이미 등록한 스트리머 기준으로 수신합니다.</p>
        <div className="ssapi-flow" aria-label="SSAPI 연결 흐름">
          <b>SSAPI 연결 흐름</b>
          <span>소켓 연결</span><i>→</i><span>API 키 로그인</span><i>→</i><span>후원 이벤트만 수신</span><i>→</i><span>후원 메시지·금액을 룰렛 표로 반영</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <section className="panel wheel-panel">
          <div className="section-heading compact">
            <div>
              <p className="section-kicker">3. 가중치 룰렛</p>
              <h2>후원 표 비율대로 당첨</h2>
            </div>
            {spinPlan && <span className="spin-lock">이번 회차 표 고정</span>}
          </div>
          <RouletteWheel items={wheelItems} spinPlan={spinPlan} onSpinFinished={finishSpin} />
          <button type="button" className="spin-btn" onClick={openChallenge} disabled={!items.length || Boolean(spinPlan)}>룰렛 돌리기 <span>↻</span></button>
          <p className="wheel-note">룰렛 시작 후 들어온 후원은 다음 회차에 반영됩니다.</p>
        </section>

        <section className="panel ranking-panel">
          <div className="section-heading compact">
            <div>
              <p className="section-kicker">LIVE RANKING</p>
              <h2>실시간 순위</h2>
            </div>
            <span className="item-count">{items.length}개 선택지</span>
          </div>
          <RankList items={items} onAdjust={adjustItem} onDelete={deleteItem} />
        </section>
      </section>

      <section className="bottom-grid">
        <section className="panel manual-panel">
          <div className="section-heading compact">
            <div>
              <p className="section-kicker">4. 수동 추가</p>
              <h2>직접 표 넣기</h2>
            </div>
          </div>
          <form className="manual-form" onSubmit={handleManualAdd}>
            <input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="예: 육회" />
            <input type="number" min="1" value={manualVotes} onChange={(event) => setManualVotes(event.target.value)} aria-label="추가할 표 수" />
            <button type="submit" className="primary-btn">표 추가</button>
          </form>
          <p className="small-note">공백·기호를 제외한 이름이 같으면 자동으로 표가 합산됩니다. 예: “김치찌개”, “김치 찌개”</p>
        </section>

        <section className="panel log-panel">
          <div className="section-heading compact">
            <div>
              <p className="section-kicker">RECENT</p>
              <h2>최근 반영 내역</h2>
            </div>
            <span className="item-count">최근 {donationLogs.length}건</span>
          </div>
          <div className="log-list">
            {!donationLogs.length && <div className="empty-state log-empty">아직 반영된 내역이 없습니다.</div>}
            {donationLogs.map((log) => (
              <div className="log-row" key={log.id}>
                <div className="log-main">
                  <strong>{log.message}</strong>
                  <span>{log.source === 'manual' ? '수동 추가' : log.nickname}</span>
                </div>
                <div className="log-side">
                  {log.source === 'donation' && <span>{formatWon(log.amount)}</span>}
                  <b>+{formatVotes(log.addedVotes)}</b>
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>

      {challengeOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setChallengeOpen(false)}>
          <div className="challenge-modal" role="dialog" aria-modal="true" aria-label="룰렛 도전 확인" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-badge">READY?</div>
            <h2>룰렛 도전!</h2>
            <p>“도전!”을 입력하고 Enter를 누르면 룰렛이 시작됩니다.</p>
            <input
              autoFocus
              value={challengeText}
              onChange={(event) => setChallengeText(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') startSpin(); }}
              placeholder="도전!"
            />
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setChallengeOpen(false)}>취소</button>
              <button type="button" className="spin-btn mini" onClick={startSpin} disabled={challengeText.trim() !== '도전!'}>시작</button>
            </div>
          </div>
        </div>
      )}

      {winner && (
        <div className="modal-backdrop winner-backdrop" role="presentation" onMouseDown={() => setWinner(null)}>
          <div className="winner-card" role="dialog" aria-modal="true" aria-label="룰렛 결과" onMouseDown={(event) => event.stopPropagation()}>
            <div className="confetti confetti-a" /><div className="confetti confetti-b" /><div className="confetti confetti-c" /><div className="confetti confetti-d" />
            <p>🎉 당첨 선택지</p>
            <h2>{winner.label}</h2>
            <strong>{formatVotes(winner.votes)}</strong>
            <button type="button" className="primary-btn" onClick={() => setWinner(null)}>확인</button>
          </div>
        </div>
      )}
    </main>
  );
}
