# 후원 룰렛 — 심플 버전

치지직·숲 방송용 후원 집계 룰렛입니다.

## 반영한 변경점

- 표시 이름, 대표 이미지 URL, SSAPI 키 입력, `이 기기에 저장` UI 제거
- 상단 `사용 설명서` 버튼으로 안내 모달 표시
- 최소한의 카드와 색상만 사용하는 단순한 화면 구성
- 표 수 `− / 직접 입력 / +` 조정 및 개별 삭제
- SSAPI 후원 수신 버튼만 노출
- GitHub Pages용 Actions 워크플로 포함

## 실행

```bash
npm install
npm run dev
```

## GitHub Pages 배포

1. 모든 파일을 저장소의 `main` 브랜치에 올립니다.
2. 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 선택합니다.
3. `.github/workflows/deploy.yml`이 자동으로 빌드와 배포를 실행합니다.

> 이 프로젝트의 SSAPI 키는 웹 화면에는 렌더링되지 않습니다. 정적 프런트엔드이므로 빌드된 JavaScript를 분석하면 코드에서 확인할 수 있습니다.
