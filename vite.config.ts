import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 상대 경로를 사용하므로 GitHub Pages의 저장소 하위 경로에서도 동작합니다.
export default defineConfig({
  base: './',
  plugins: [react()],
});
