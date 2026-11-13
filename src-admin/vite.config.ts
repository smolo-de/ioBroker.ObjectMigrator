import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// builds the admin tab into admin/tab.html + admin/build/
export default defineConfig({
    root: __dirname,
    base: './',
    plugins: [react()],
    build: {
        outDir: '../admin',
        emptyOutDir: false,
        assetsDir: 'build',
        rollupOptions: { input: { tab: `${__dirname}/tab.html` } },
        chunkSizeWarningLimit: 2000,
    },
});
