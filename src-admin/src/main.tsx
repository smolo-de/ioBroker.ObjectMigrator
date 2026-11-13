import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Connection, tabParams } from './connection';
import './styles.css';

const params = tabParams();
const dark = params.theme === 'dark';
const theme = createTheme({
    palette: { mode: dark ? 'dark' : 'light', primary: { main: '#3399cc' } },
    typography: { fontSize: 13 },
});
const socket = new Connection(`objectmigrator.${params.instance}`);

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <App
                socket={socket}
                dark={dark}
            />
        </ThemeProvider>
    </React.StrictMode>,
);
