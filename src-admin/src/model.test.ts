import { expect } from 'chai';
import {
    ALL_OBJECTS,
    namespaceOf,
    parentsOf,
    rootShowing,
    addLink,
    changedTargets,
    removeLink,
    addState,
    applyTemplate,
    makeTemplate,
    setOptions,
    templateVariables,
    anchorRow,
    applyMirror,
    autoLinks,
    buildPlan,
    buildTree,
    compat,
    customIcons,
    emptyState,
    expandToDepth,
    flatten,
    importAliases,
    isUnchangedImport,
    moveDraft,
    removeDraft,
    type DraftObject,
    type EditorState,
    type ObjInfo,
} from './model';

const state = (common: Record<string, unknown> = {}): ObjInfo => ({
    type: 'state',
    common: { type: 'number', role: 'value', ...common },
});

const objects: Record<string, ObjInfo> = {
    'lux.0.info': { type: 'channel', common: { name: 'Informationen' } },
    'lux.0.info.temp': state({ name: 'Temperatur', unit: '°C', custom: { 'history.0': { enabled: true } } }),
    'lux.0.info.pump': state({ name: 'Pumpe', type: 'boolean' }),
    'lux.0.extra.x': state(),
};

const draft = (id: string, type: DraftObject['type'], sourceId?: string): DraftObject => ({
    id,
    type,
    common: type === 'state' ? { name: id.split('.').pop(), type: 'number', alias: { id: sourceId } } : {},
    native: {},
    sourceId,
});

describe('admin/model', () => {
    it('buildTree adds missing parents as virtual nodes and sorts nodes before states', () => {
        const tree = buildTree('lux.0', objects);
        expect(tree.children.map(c => `${c.part}:${c.type}`)).to.deep.equal(['info:channel', 'extra:virtual']);
        expect(tree.children[0].children.map(c => c.part)).to.deep.equal(['pump', 'temp']);
    });

    it('buildTree shows drafts, an existing object wins', () => {
        const tree = buildTree('alias.0.wp', { 'alias.0.wp.a': state({ name: 'exists' }) }, [
            draft('alias.0.wp.a', 'state'),
            draft('alias.0.wp.b', 'state'),
        ]);
        expect(tree.children.map(c => `${c.part}:${c.draft}`)).to.deep.equal(['a:false', 'b:true']);
    });

    it('flatten respects expansion, the filter shows parents of matches', () => {
        const tree = buildTree('lux.0', objects);
        expect(flatten(tree, new Set(['lux.0'])).map(r => r.node.id)).to.deep.equal([
            'lux.0',
            'lux.0.info',
            'lux.0.extra',
        ]);
        const filtered = flatten(tree, new Set(), n => n.part === 'temp');
        expect(filtered.map(r => r.node.id)).to.deep.equal(['lux.0', 'lux.0.info', 'lux.0.info.temp']);
        expect(expandToDepth(tree, 0)).to.deep.equal(new Set(['lux.0']));
    });

    it('whole object tree: namespaces at the top, not loaded ones can be expanded', () => {
        const tree = buildTree(
            '',
            objects,
            [],
            [
                { id: 'lux.0', loaded: true },
                { id: 'hm-rpc.0', loaded: false },
                { id: 'empty.0', loaded: true },
            ],
        );
        expect(tree.children.map(c => c.id)).to.deep.equal(['empty', 'hm-rpc', 'lux']);
        const rows = flatten(tree, new Set(['', 'hm-rpc', 'lux', 'empty']));
        expect(rows.map(r => `${r.node.id}:${r.hasChildren}`)).to.deep.equal([
            ':true',
            'empty:true',
            'empty.0:false',
            'hm-rpc:true',
            'hm-rpc.0:true',
            'lux:true',
            'lux.0:true',
        ]);
        expect(namespaceOf('hm-rpc.0.ABC.1.STATE')).to.equal('hm-rpc.0');
        expect(namespaceOf('system')).to.equal(undefined);
        expect(parentsOf('lux.0.info.temp', '')).to.deep.equal(['lux', 'lux.0', 'lux.0.info']);
        expect(parentsOf('lux.0.info.temp', 'lux.0')).to.deep.equal(['lux.0', 'lux.0.info']);
        expect(parentsOf('other.0.x', 'lux.0')).to.deep.equal([]);
    });

    it('anchorRow falls back to the nearest visible parent', () => {
        const index = new Map([
            ['lux.0', 0],
            ['lux.0.info', 1],
        ]);
        expect(anchorRow('lux.0.info.temp', index)).to.equal(1);
        expect(anchorRow('other.0.x', index)).to.equal(undefined);
    });

    it('addLink moves an existing link of the source (one source - one target)', () => {
        let s = addLink(emptyState(), 'a', 't1');
        s = addLink(s, 'a', 't2');
        s = addLink(s, 'b', 't2');
        expect(s.links).to.deep.equal([
            { sourceId: 'a', targetId: 't2' },
            { sourceId: 'b', targetId: 't2' },
        ]);
    });

    it('autoLinks matches by relative path, then by ID part or name', () => {
        const left = buildTree('lux.0', objects);
        const right = buildTree('alias.0.wp', {
            'alias.0.wp.info.temp': state(),
            'alias.0.wp.other.Pumpe': state({ type: 'boolean' }),
        });
        expect(autoLinks(left, right)).to.deep.equal([
            { sourceId: 'lux.0.info.pump', targetId: 'alias.0.wp.other.Pumpe' },
            { sourceId: 'lux.0.info.temp', targetId: 'alias.0.wp.info.temp' },
        ]);
    });

    it('compat: other type is red, other unit yellow', () => {
        expect(compat(state(), state()).level).to.equal('ok');
        expect(compat(state(), state({ type: 'string' })).level).to.equal('error');
        expect(compat(state({ unit: '°C' }), state()).level).to.equal('warn');
    });

    it('applyMirror links every mirrored state, removeDraft removes the subtree with its links', () => {
        let s: EditorState = { ...emptyState(), basePath: 'alias.0.wp' };
        s = applyMirror(s, [
            draft('alias.0.wp', 'device'),
            draft('alias.0.wp.info', 'channel'),
            draft('alias.0.wp.info.temp', 'state', 'lux.0.info.temp'),
            draft('alias.0.wp.x', 'state', 'lux.0.extra.x'),
        ]);
        expect(s.links.length).to.equal(2);
        s = removeDraft(s, 'alias.0.wp.info');
        expect(s.drafts.map(d => d.id)).to.deep.equal(['alias.0.wp', 'alias.0.wp.x']);
        expect(s.links).to.deep.equal([{ sourceId: 'lux.0.extra.x', targetId: 'alias.0.wp.x' }]);
    });

    it('moveDraft moves the subtree, links and options follow, missing parents become folders', () => {
        let s: EditorState = { ...emptyState(), basePath: 'alias.0.wp' };
        s = applyMirror(s, [draft('alias.0.wp.info', 'channel'), draft('alias.0.wp.info.temp', 'state', 'src')]);
        s.options['alias.0.wp.info.temp'] = { history: false };
        s = moveDraft(s, 'alias.0.wp.info', 'alias.0.wp.neu.sensoren');
        expect(s.drafts.map(d => d.id).sort()).to.deep.equal([
            'alias.0.wp.neu',
            'alias.0.wp.neu.sensoren',
            'alias.0.wp.neu.sensoren.temp',
        ]);
        expect(s.links[0].targetId).to.equal('alias.0.wp.neu.sensoren.temp');
        expect(s.options['alias.0.wp.neu.sensoren.temp']).to.deep.equal({ history: false });
    });

    it('buildPlan: two sources → switch rule, settings of the first, history off at the second, alias.id = new', () => {
        let s: EditorState = { ...emptyState(), basePath: 'alias.0.wp' };
        s = applyMirror(s, [draft('alias.0.wp.temp', 'state', 'old.0.temp')]);
        s = addLink(s, 'new.0.temp', 'alias.0.wp.temp');
        const plan = buildPlan(s, {});
        expect(plan.tasks).to.deep.equal([
            {
                target: 'alias.0.wp.temp',
                sources: [
                    { id: 'old.0.temp', priority: 0 },
                    { id: 'new.0.temp', priority: 1 },
                ],
                overlap: { type: 'switch' },
            },
        ]);
        expect(plan.mappings![0].sourceId).to.equal('old.0.temp');
        // by default nothing happens at the sources
        expect(plan.mappings![0].disableHistoryAt).to.equal(undefined);
        expect((plan.drafts![0].common.alias as { id: string }).id).to.equal('new.0.temp');
        // "disable at the source" also disables the history of the further sources
        const disabling = buildPlan(setOptions(s, 'alias.0.wp.temp', { sourceMode: 'disable' }), {});
        expect(disabling.mappings![0].disableHistoryAt).to.deep.equal(['new.0.temp']);
    });

    it('buildPlan: an existing alias is remapped to the new source, options switch parts off', () => {
        let s = addLink(emptyState(), 'new.0.temp', 'alias.0.wp.temp');
        const existing = { 'alias.0.wp.temp': state({ alias: { id: 'old.0.temp' } }) };
        expect(buildPlan(s, existing).aliases).to.deep.equal([
            { targetId: 'alias.0.wp.temp', alias: { id: 'new.0.temp' } },
        ]);
        s = { ...s, options: { 'alias.0.wp.temp': { history: false, settings: false } } };
        const plan = buildPlan(s, existing);
        expect(plan.tasks).to.deep.equal([]);
        expect(plan.mappings).to.deep.equal([]);
        // the remap does not depend on "take over settings"
        expect(plan.aliases).to.have.length(1);
    });

    it('bug 1: a draft written by an earlier run is remapped when a new source is linked', () => {
        let s: EditorState = { ...emptyState(), basePath: 'alias.0.wp' };
        s = applyMirror(s, [draft('alias.0.wp.temp', 'state', 'old.0.temp')]);
        s = addLink(s, 'new.0.temp', 'alias.0.wp.temp');
        // the first run created the alias with the old source
        const written = { 'alias.0.wp.temp': state({ alias: { id: 'old.0.temp' } }) };
        const plan = buildPlan(s, written);
        expect(plan.aliases).to.deep.equal([{ targetId: 'alias.0.wp.temp', alias: { id: 'new.0.temp' } }]);
        // the draft is not changed for an existing object (the adapter skips it anyway)
        expect((plan.drafts![0].common.alias as { id: string }).id).to.equal('old.0.temp');
    });

    it('bug 2: a removed conversion is sent as alias without read/write (the adapter replaces common.alias)', () => {
        const s = addLink(emptyState(), 'new.0.temp', 'alias.0.wp.temp');
        const existing = { 'alias.0.wp.temp': state({ alias: { id: 'new.0.temp', read: 'val * 10' } }) };
        expect(buildPlan(s, existing).aliases).to.deep.equal([
            { targetId: 'alias.0.wp.temp', alias: { id: 'new.0.temp' } },
        ]);
        // nothing to do if it is the same already
        const same = { 'alias.0.wp.temp': state({ alias: { id: 'new.0.temp' } }) };
        expect(buildPlan(s, same).aliases).to.deep.equal([]);
    });

    it('partial write: only the targets and drafts of a subtree (WR-04)', () => {
        let s: EditorState = { ...emptyState(), basePath: 'alias.0.wp' };
        s = applyMirror(s, [
            draft('alias.0.wp', 'device'),
            draft('alias.0.wp.a', 'channel'),
            draft('alias.0.wp.a.x', 'state', 'src.0.x'),
            draft('alias.0.wp.b', 'channel'),
            draft('alias.0.wp.b.y', 'state', 'src.0.y'),
        ]);
        const plan = buildPlan(s, {}, 'alias.0.wp.a');
        expect(plan.drafts!.map(d => d.id)).to.deep.equal(['alias.0.wp', 'alias.0.wp.a', 'alias.0.wp.a.x']);
        expect(plan.tasks!.map(t => t.target)).to.deep.equal(['alias.0.wp.a.x']);
    });

    it('excluded values and "no rooms/functions" reach the plan', () => {
        let s = addLink(emptyState(), 'src.0.x', 'alias.0.x');
        s = setOptions(s, 'alias.0.x', { excluded: ['src.0.x|1000'], enums: false });
        const plan = buildPlan(s, {});
        expect(plan.tasks![0].excluded).to.deep.equal(['src.0.x|1000']);
        expect(plan.mappings![0].enums).to.equal(false);
    });

    it('template placeholders replace the name and its ID form', () => {
        const tree = buildTree('alias.0.Kühlschrank', {}, [
            { id: 'alias.0.Kühlschrank', type: 'device', common: { name: 'Kühlschrank' }, native: {} },
            { id: 'alias.0.Kühlschrank.temp', type: 'state', common: { name: 'Temperatur Kühlschrank' }, native: {} },
        ]);
        const template = makeTemplate('T', tree, emptyState(), [{ text: 'Kühlschrank', variable: 'name' }]);
        expect(template.root.common.name).to.equal('{{name}}');
        expect(template.nodes[0].common.name).to.equal('Temperatur {{name}}');
        expect(templateVariables(template)).to.deep.equal(['name']);
    });

    it('customIcons reports the instance status', () => {
        const icons = customIcons(
            state({ custom: { 'history.0': { enabled: true }, 'lovelace.0': { enabled: false }, 'sql.0': {} } }),
            { 'history.0': { enabled: true }, 'lovelace.0': { enabled: false } },
        );
        expect(icons.map(i => `${i.key}:${i.enabled}:${i.status}`)).to.deep.equal([
            'history.0:true:active',
            'lovelace.0:false:disabled',
            'sql.0:true:missing',
        ]);
    });

    it('buildPlan: the converter of the live source becomes alias.read/write, every source history is converted', () => {
        let s: EditorState = { ...emptyState(), basePath: 'alias.0.wp' };
        s = applyMirror(s, [draft('alias.0.wp.temp', 'state', 'old.0.temp')]);
        s = addLink(s, 'new.0.temp', 'alias.0.wp.temp');
        s = setOptions(s, 'alias.0.wp.temp', {
            converters: { 'old.0.temp': { factor: 0.1 }, 'new.0.temp': { to: 'number', decimals: 1 } },
        });
        const plan = buildPlan(s, {});
        const alias = plan.drafts![0].common.alias as { id: string; read?: string };
        expect(alias.id).to.equal('new.0.temp');
        expect(alias.read).to.contain('Math.round');
        expect(plan.tasks![0].sources[0].converter).to.deep.equal({ type: 'expression', read: '(Number(val) * 0.1)' });
        expect(plan.tasks![0].sources[1].converter?.type).to.equal('expression');
    });

    it('addState creates a new value without source, buildPlan takes it with its adapter settings', () => {
        let s: EditorState = { ...emptyState(), basePath: 'alias.0.wp', drafts: [draft('alias.0.wp', 'device')] };
        const added = addState(s, 'alias.0.wp', 'Sollwert', { unit: '°C' });
        s = setOptions(added.state, added.id, { overrides: { 'history.0': { enabled: true } } });
        expect(added.id).to.equal('alias.0.wp.Sollwert');
        expect(addState(s, 'alias.0.wp', 'Sollwert').id).to.equal('alias.0.wp.Sollwert_2');
        const plan = buildPlan(s, {});
        expect(plan.mappings).to.deep.equal([
            {
                sourceId: undefined,
                targetId: 'alias.0.wp.Sollwert',
                options: { exclude: undefined, overrides: { 'history.0': { enabled: true } }, sourceMode: undefined },
            },
        ]);
        expect(plan.tasks).to.deep.equal([]);
        // written without alias.id (EM-12)
        expect(plan.drafts?.find(d => d.id === 'alias.0.wp.Sollwert')?.common).to.not.have.property('alias');
    });

    it('a mirrored value whose link was removed is written without the source of the mirror (EM-12)', () => {
        let s = applyMirror({ ...emptyState(), basePath: 'alias.0.wp' }, [
            { id: 'alias.0.wp', type: 'device', common: { name: 'wp' }, native: {} },
            {
                id: 'alias.0.wp.temp',
                type: 'state',
                common: { name: 'Temperatur', alias: { id: 'lux.0.temp' } },
                native: {},
                sourceId: 'lux.0.temp',
            },
        ]);
        expect(buildPlan(s, {}).drafts?.find(d => d.id === 'alias.0.wp.temp')?.common.alias).to.deep.equal({
            id: 'lux.0.temp',
        });
        s = removeLink(s, { sourceId: 'lux.0.temp', targetId: 'alias.0.wp.temp' });
        expect(buildPlan(s, {}).drafts?.find(d => d.id === 'alias.0.wp.temp')?.common).to.not.have.property('alias');
    });

    it('templates: made from a node, placeholders filled, settings and conversion kept', () => {
        let s: EditorState = { ...emptyState(), basePath: 'alias.0.wp' };
        s = applyMirror(s, [
            { id: 'alias.0.wp', type: 'device', common: { name: '{{name}}' }, native: {} },
            {
                id: 'alias.0.wp.temp',
                type: 'state',
                common: { name: 'Temperatur {{name}}', unit: '°C', alias: { id: 'x' } },
                native: {},
                sourceId: 'lux.0.temp',
            },
        ]);
        s = setOptions(s, 'alias.0.wp.temp', {
            overrides: { 'history.0': { enabled: true } },
            converters: { 'lux.0.temp': { factor: 0.1 } },
        });
        const tree = buildTree('alias.0.wp', {}, s.drafts);
        const template = makeTemplate('WP', tree, s);
        expect(templateVariables(template)).to.deep.equal(['name']);
        expect(template.nodes).to.deep.equal([
            { rel: 'temp', type: 'state', common: { name: 'Temperatur {{name}}', unit: '°C' } },
        ]);

        const next = applyTemplate(emptyState(), template, 'alias.0.keller', { name: 'Keller' });
        expect(next.drafts.map(d => `${d.id}:${String(d.common.name)}`)).to.deep.equal([
            'alias.0.keller:Keller',
            'alias.0.keller.temp:Temperatur Keller',
        ]);
        expect(next.options['alias.0.keller.temp']).to.deep.equal({
            overrides: { 'history.0': { enabled: true } },
            converters: { '*': { factor: 0.1 } },
        });
        // a source linked later gets the template conversion
        const linked = addLink(next, 'new.0.t', 'alias.0.keller.temp');
        expect((buildPlan(linked, {}).drafts![1].common.alias as { read?: string }).read).to.equal(
            '(Number(val) * 0.1)',
        );
    });

    it('removing the last link of an existing object discards its pending changes, drafts keep them', () => {
        let s = addLink(emptyState(), 'src.0.a', 'alias.0.x.a');
        s = setOptions(s, 'alias.0.x.a', { overrides: { 'history.0': { enabled: true } } });
        expect([...changedTargets(s)]).to.deep.equal(['alias.0.x.a']);
        s = removeLink(s, { sourceId: 'src.0.a', targetId: 'alias.0.x.a' });
        expect(s.options).to.deep.equal({});

        let d: EditorState = { ...emptyState(), drafts: [draft('alias.0.x.new', 'state')] };
        d = addLink(d, 'src.0.b', 'alias.0.x.new');
        d = setOptions(d, 'alias.0.x.new', {
            overrides: { 'history.0': { enabled: true } },
            converters: { 'src.0.b': { factor: 2 } },
        });
        d = removeLink(d, { sourceId: 'src.0.b', targetId: 'alias.0.x.new' });
        expect(d.options['alias.0.x.new']).to.deep.equal({
            overrides: { 'history.0': { enabled: true } },
            converters: {},
        });
        expect(changedTargets(d).size).to.equal(0);
    });

    it('moving a source to another target cleans up the old existing target', () => {
        let s = addLink(emptyState(), 'src.0.a', 'alias.0.old');
        s = setOptions(s, 'alias.0.old', { overrides: { 'history.0': { enabled: true } } });
        s = addLink(s, 'src.0.a', 'alias.0.new');
        expect(s.links).to.deep.equal([{ sourceId: 'src.0.a', targetId: 'alias.0.new' }]);
        expect(s.options['alias.0.old']).to.equal(undefined);
    });

    describe('reading existing aliases in (FR-56, UC-7a)', () => {
        const objects: Record<string, ObjInfo> = {
            'alias.0.dev': { type: 'device', common: { name: 'dev' } },
            'alias.0.dev.temp': state({ alias: { id: 'old.0.t' }, unit: '°C' }),
            'alias.0.dev.set': state({
                write: true,
                alias: { id: { read: 'old.0.set_actual', write: 'old.0.set_target' } },
            }),
            'alias.0.dev.mode': state({
                type: 'string',
                write: true,
                alias: { id: 'old.0.mode', read: 'val === 1 ? "an" : "aus"', write: 'val === "an" ? 1 : 0' },
            }),
            'alias.0.dev.empty': state({}),
            'alias.0.other': state({ alias: { id: 'old.0.x' } }),
            'old.0.t': state({ unit: '°C' }),
            'old.0.set_actual': state({}),
            'old.0.set_target': state({ write: true }),
            'old.0.mode': state({ write: true }),
            'new.0.t': state({ unit: '°C' }),
        };

        it('every alias.id below the node becomes a link; formulas, write ID; nothing to write while unchanged', () => {
            const res = importAliases(emptyState(), objects, 'alias.0.dev');
            expect(res.imported).to.deep.equal(['alias.0.dev.mode', 'alias.0.dev.set', 'alias.0.dev.temp']);
            const s = res.state;
            expect(s.sourceRoot).to.equal('old.0');
            expect(s.links).to.have.deep.members([
                { sourceId: 'old.0.t', targetId: 'alias.0.dev.temp' },
                { sourceId: 'old.0.set_actual', targetId: 'alias.0.dev.set' },
                { sourceId: 'old.0.mode', targetId: 'alias.0.dev.mode' },
            ]);
            expect(s.options['alias.0.dev.set']).to.deep.include({
                imported: { read: 'old.0.set_actual', write: 'old.0.set_target' },
                history: false,
                settings: false,
            });
            expect(s.options['alias.0.dev.mode'].converters).to.deep.equal({
                'old.0.mode': { read: 'val === 1 ? "an" : "aus"', write: 'val === "an" ? 1 : 0' },
            });
            for (const id of res.imported) {
                expect(isUnchangedImport(s, id, objects[id]), id).to.equal(true);
            }
            // "Schreiben" with nothing changed: no alias update, no history, no settings
            const plan = buildPlan(s, objects);
            expect(plan).to.deep.include({ aliases: [], tasks: [], mappings: [] });
            // reading in again changes nothing
            const again = importAliases(s, objects, 'alias.0.dev');
            expect(again.imported).to.deep.equal([]);
            expect(again.already.length).to.equal(3);
            expect(again.state).to.equal(s);
        });

        it('the left root is widened until it shows the sources (up to all objects)', () => {
            // root already shows them: unchanged
            let res = importAliases({ ...emptyState(), sourceRoot: 'old.0' }, objects, 'alias.0.dev');
            expect(res.state.sourceRoot).to.equal('old.0');
            expect(res.sources).to.have.members(['old.0.mode', 'old.0.set_actual', 'old.0.t']);
            // a deeper root: the common parent
            res = importAliases({ ...emptyState(), sourceRoot: 'old.0.sub' }, objects, 'alias.0.dev');
            expect(res.state.sourceRoot).to.equal('old.0');
            // another adapter: all objects
            res = importAliases({ ...emptyState(), sourceRoot: 'new.0' }, objects, 'alias.0.dev');
            expect(res.state.sourceRoot).to.equal(ALL_OBJECTS);
            // all objects stay
            res = importAliases({ ...emptyState(), sourceRoot: ALL_OBJECTS }, objects, 'alias.0.dev');
            expect(res.state.sourceRoot).to.equal(ALL_OBJECTS);
            // a single value read in
            res = importAliases(emptyState(), objects, 'alias.0.dev.temp');
            expect(res.imported).to.deep.equal(['alias.0.dev.temp']);
            expect(res.state.sourceRoot).to.equal('old.0');
            // already linked, root changed since: shown again
            const s = { ...importAliases(emptyState(), objects, 'alias.0.dev').state, sourceRoot: 'new.0' };
            res = importAliases(s, objects, 'alias.0.dev');
            expect(res.imported).to.deep.equal([]);
            expect(res.state.sourceRoot).to.equal(ALL_OBJECTS);
            expect(rootShowing('', ['a.0.x.y', 'b.0.z'])).to.equal(ALL_OBJECTS);
            expect(rootShowing('', ['a.0.x.y', 'a.0.x.z'])).to.equal('a.0.x');
            expect(rootShowing('a.0', [])).to.equal('a.0');
        });

        it('remapping a read-in alias: the new source becomes alias.id, the old write ID is dropped', () => {
            let s = importAliases(emptyState(), objects, 'alias.0.dev').state;
            s = addLink(s, 'new.0.t', 'alias.0.dev.temp');
            expect(isUnchangedImport(s, 'alias.0.dev.temp', objects['alias.0.dev.temp'])).to.equal(false);
            let plan = buildPlan(s, objects);
            expect(plan.aliases).to.deep.equal([{ targetId: 'alias.0.dev.temp', alias: { id: 'new.0.t' } }]);
            // still no history and no settings unless switched on
            expect(plan.tasks).to.deep.equal([]);
            expect(plan.mappings).to.deep.equal([]);
            s = setOptions(s, 'alias.0.dev.temp', { history: true });
            plan = buildPlan(s, objects);
            expect(plan.tasks?.map(t => t.sources.map(x => x.id))).to.deep.equal([['old.0.t', 'new.0.t']]);

            // separate read/write IDs stay while the read source stays live
            let w = importAliases(emptyState(), objects, 'alias.0.dev').state;
            w = setOptions(w, 'alias.0.dev.set', { converters: { 'old.0.set_actual': { factor: 2 } } });
            expect(buildPlan(w, objects).aliases).to.deep.equal([
                {
                    targetId: 'alias.0.dev.set',
                    alias: {
                        id: { read: 'old.0.set_actual', write: 'old.0.set_target' },
                        read: '(Number(val) * 2)',
                        write: '((Number(val)) / 2)',
                    },
                },
            ]);
        });

        it('{ read: X, write: X } counts as the same mapping as X', () => {
            const objs: Record<string, ObjInfo> = {
                'alias.0.d.same': state({ alias: { id: { read: 'old.0.same', write: 'old.0.same' } } }),
            };
            const s = importAliases(emptyState(), objs, 'alias.0.d').state;
            expect(isUnchangedImport(s, 'alias.0.d.same', objs['alias.0.d.same'])).to.equal(true);
            expect(buildPlan(s, objs).aliases).to.deep.equal([]);
        });

        it('a source that is linked to another target already is reported, not linked twice (AM-13)', () => {
            const s = addLink(emptyState(), 'old.0.t', 'alias.0.elsewhere');
            const res = importAliases(s, objects, 'alias.0.dev.temp');
            expect(res.imported).to.deep.equal([]);
            expect(res.conflicts).to.deep.equal([
                { targetId: 'alias.0.dev.temp', sourceId: 'old.0.t', linkedTo: 'alias.0.elsewhere' },
            ]);
        });
    });
});
