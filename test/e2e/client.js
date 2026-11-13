'use strict';
/*
 * Minimal client for the admin websocket ([type, id, name, args]) - the same way the admin tab talks
 * to ioBroker. Used by the end-to-end tests and their setup scripts.
 */

const URL = process.env.OM_ADMIN_WS || 'ws://127.0.0.1:8081/?sid=e2e&name=admin';
const INSTANCE = process.env.OM_INSTANCE || 'objectmigrator.0';
const HISTORY = process.env.OM_HISTORY || 'history.0';

function connect(url = URL) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const pending = new Map();
        let id = 1;
        const call = (name, ...args) =>
            new Promise((res, rej) => {
                const myId = ++id;
                const timer = setTimeout(() => rej(new Error(`timeout ${name}`)), 600_000);
                pending.set(myId, value => {
                    clearTimeout(timer);
                    res(value);
                });
                ws.send(JSON.stringify([3, myId, name, args]));
            });
        const api = {
            call,
            /** sendTo to the migrator, unpacks { ok, data } */
            async om(command, message = {}) {
                const [answer] = await call('sendTo', INSTANCE, command, message);
                if (!answer?.ok) {
                    throw new Error(`${command}: ${JSON.stringify(answer?.error)}`);
                }
                return answer.data;
            },
            async history(command, message) {
                const [answer] = await call('sendTo', HISTORY, command, message);
                return answer;
            },
            async getObject(oid) {
                return (await call('getObject', oid))[1];
            },
            async getState(oid) {
                return (await call('getState', oid))[1];
            },
            /** all objects (state, channel, device, folder) below a prefix */
            async objectsBelow(prefix) {
                const result = {};
                for (const type of ['state', 'channel', 'device', 'folder']) {
                    const [, view] = await call('getObjectView', 'system', type, {
                        startkey: `${prefix}.`,
                        endkey: `${prefix}.香`,
                    });
                    for (const row of view?.rows ?? []) {
                        result[row.id] = row.value;
                    }
                }
                return result;
            },
            /** raw history values (asc), without the null markers of the history adapter */
            async values(oid, { withNull = false } = {}) {
                const all = [];
                for (let offset = 0; ;) {
                    const r = await api.history('getRawEntries', {
                        id: oid,
                        start: 0,
                        end: Date.now() + 86_400_000,
                        sort: 'asc',
                        limit: 5000,
                        offset,
                        noTotal: true,
                    });
                    const page = r?.result ?? [];
                    if (!page.length) {
                        return withNull ? all : all.filter(v => v.val !== null);
                    }
                    all.push(...page);
                    offset += page.length;
                }
            },
            close: () => ws.close(),
        };
        ws.onmessage = ev => {
            const [type, msgId, name, args] = JSON.parse(ev.data);
            if (type === 1) {
                ws.send(JSON.stringify([2]));
            } else if (type === 0 && name === '___ready___') {
                resolve(api);
            } else if (type === 3 && pending.has(msgId)) {
                pending.get(msgId)(args ?? []);
                pending.delete(msgId);
            }
        };
        ws.onerror = () => reject(new Error(`websocket error - is ioBroker running at ${url}?`));
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Entities as the lovelace frontend gets them (`get_states` of the Home Assistant websocket API).
 * Needs a lovelace instance without authentication.
 *
 * @param {string} url websocket of the lovelace instance
 */
function lovelaceStates(url = process.env.OM_LOVELACE_WS || 'ws://127.0.0.1:8091/api/websocket') {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('lovelace did not answer'));
        }, 15_000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, type: 'get_states' }));
        ws.onmessage = ev => {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'auth_required') {
                ws.send(JSON.stringify({ type: 'auth', access_token: 'no_token' }));
            } else if (msg.type === 'auth_ok') {
                ws.send(JSON.stringify({ id: 1, type: 'get_states' }));
            } else if (msg.type === 'result' && msg.id === 1) {
                clearTimeout(timer);
                ws.close();
                resolve(msg.result ?? []);
            }
        };
        ws.onerror = () => reject(new Error(`websocket error - is lovelace running at ${url}?`));
    });
}

module.exports = { connect, sleep, lovelaceStates, INSTANCE, HISTORY };
