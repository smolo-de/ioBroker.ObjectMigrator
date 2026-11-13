import type { Message } from '../messages';

/** Adapters that log history - special rules for `enabled` and `aliasId` (03 §3) */
export const HISTORY_ADAPTERS = ['history', 'sql', 'influxdb'];

/** Status of an instance referenced by a custom key (SM-02) */
export type InstanceStatus = 'active' | 'disabled' | 'missing';

/** What happens with the settings at the source (FR-34) */
export type SourceMode = 'keep' | 'disable' | 'remove';

/** Common attributes that can be taken over (FR-33) */
export const COPYABLE_COMMON = [
    'name',
    'desc',
    'role',
    'unit',
    'min',
    'max',
    'step',
    'states',
    'icon',
    'color',
] as const;
export type CopyableCommon = (typeof COPYABLE_COMMON)[number];

/** Options for one state */
export interface SettingsOptions {
    /** Custom keys to take over - default: all of the source */
    include?: string[];
    /** Custom keys NOT to take over (SO-06) */
    exclude?: string[];
    /** e.g. { 'history.0': 'history.1' } (FR-37) */
    instanceRemap?: Record<string, string>;
    /** Overrides per (target) custom key, field by field; null removes a field (SO-04) */
    overrides?: Record<string, Record<string, unknown>>;
    /** Take over settings of instances that are not installed (SM-03). Default true */
    copyUninstalled?: boolean;
    /** Default 'disable' */
    sourceMode?: SourceMode;
    /** Default true */
    copySmartName?: boolean;
    /** Attributes copied only if empty at the target, default: none */
    copyCommon?: CopyableCommon[];
    /** Overrides of common attributes / smartName (SO-07) */
    commonOverrides?: Partial<Record<CopyableCommon | 'smartName', unknown>>;
}

/** Result for one state - everything that has to be written */
export interface SettingsPlan {
    /** Merged into `common.custom` of the target */
    targetCustom: Record<string, Record<string, unknown>>;
    /** Merged into `common.custom` of the source; null removes the key */
    sourceCustom: Record<string, Record<string, unknown> | null>;
    /** Merged into `common` of the target (smartName and copied attributes) */
    targetCommon: Record<string, unknown>;
    /** Status per target custom key, for the icons in the UI */
    status: Record<string, InstanceStatus>;
    /** Hints for "Prüfen" */
    warnings: Message[];
}

/**
 * Adapter name of a custom key: `history.0` → `history`
 *
 * @param key - custom key
 */
export function adapterOfKey(key: string): string {
    return key.split('.')[0];
}

function isEmpty(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        value === '' ||
        (typeof value === 'object' && !Object.keys(value).length)
    );
}

/**
 * Deep merge for plain objects: `b` wins, null in `b` deletes the field
 *
 * @param a - base
 * @param b - changes
 */
export function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) {
        // keys from a stored plan must not change prototypes
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }
        if (value === null) {
            delete result[key];
        } else if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            result[key] &&
            typeof result[key] === 'object' &&
            !Array.isArray(result[key])
        ) {
            result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Plans the takeover of all settings of a source state to a target state (03).
 *
 * @param source - source object
 * @param target - target object (may be a draft that does not exist yet)
 * @param instances - status per instance key (`history.0` → 'active'), from `system.adapter.*`
 * @param options - selection, overrides, modes
 */
export function planSettings(
    source: ioBroker.Object,
    target: Partial<ioBroker.Object> | undefined,
    instances: Record<string, InstanceStatus>,
    options: SettingsOptions = {},
): SettingsPlan {
    const plan: SettingsPlan = { targetCustom: {}, sourceCustom: {}, targetCommon: {}, status: {}, warnings: [] };
    const sourceMode = options.sourceMode ?? 'keep';
    const copyUninstalled = options.copyUninstalled ?? true;
    const sourceCustom = (source.common?.custom ?? {}) as Record<string, Record<string, unknown> | null>;
    const targetCustom = ((target?.common as ioBroker.StateCommon | undefined)?.custom ?? {}) as Record<
        string,
        Record<string, unknown>
    >;

    for (const [key, settings] of Object.entries(sourceCustom)) {
        if (!settings || typeof settings !== 'object') {
            continue;
        }
        if (options.include && !options.include.includes(key)) {
            continue;
        }
        if (options.exclude?.includes(key)) {
            continue;
        }

        const targetKey = options.instanceRemap?.[key] ?? key;
        const status = instances[targetKey] ?? 'missing';
        if (status === 'missing') {
            if (!copyUninstalled) {
                plan.warnings.push({ code: 'instanceMissingSkipped', args: { key, instance: targetKey } });
                continue;
            }
            plan.warnings.push({ code: 'instanceMissingCopied', args: { key, instance: targetKey } });
        } else if (status === 'disabled') {
            plan.warnings.push({ code: 'instanceDisabled', args: { key, instance: targetKey } });
        }

        const adapter = adapterOfKey(key);
        let value: Record<string, unknown> = structuredClone(settings);

        if (HISTORY_ADAPTERS.includes(adapter)) {
            // one-time cleanup: no redirection, the values are migrated into the target ID (04 §0.1)
            value.aliasId = '';
        }

        const existing = targetCustom[targetKey];
        if (existing) {
            plan.warnings.push({ code: 'targetHasSettings', args: { key: targetKey } });
            value = deepMerge(existing, value);
            // an active setting at the target is never switched off by the source - the source is
            // disabled by the migration itself, so writing the same plan again must not disable the target
            if (existing.enabled === true) {
                value.enabled = true;
            }
        }

        // overrides of the user win over everything (SO-04)
        const override = options.overrides?.[targetKey];
        if (override) {
            value = deepMerge(value, override);
        }

        plan.targetCustom[targetKey] = value;
        plan.status[targetKey] = status;

        // source side - by default nothing is changed at the source (D-17)
        if (sourceMode === 'remove') {
            plan.sourceCustom[key] = null;
        } else if (sourceMode === 'disable') {
            // history adapters evaluate `enabled` - their settings stay at the source, switched off.
            // Other adapters (e.g. lovelace) treat every entry as active: the admin removes an entry
            // when it is switched off, so does the migration - otherwise lovelace keeps the entity at
            // the source and the target gets a duplicate
            if (!HISTORY_ADAPTERS.includes(adapter)) {
                plan.sourceCustom[key] = null;
            } else if (settings.enabled !== false) {
                plan.sourceCustom[key] = { enabled: false };
            }
        } else if (settings.enabled !== false && value.enabled !== false) {
            if (HISTORY_ADAPTERS.includes(adapter)) {
                plan.warnings.push({ code: 'doubleLogging', args: { key } });
            } else if (adapter === 'lovelace') {
                plan.warnings.push({ code: 'lovelaceDuplicate', args: { key } });
            }
        }
    }

    // adapters switched on in the editor that the source does not have (SO-08): the override is the setting
    for (const [key, override] of Object.entries(options.overrides ?? {})) {
        if (key in plan.targetCustom || options.exclude?.includes(key) || !override) {
            continue;
        }
        plan.targetCustom[key] = deepMerge(targetCustom[key] ?? {}, override);
        plan.status[key] = instances[key] ?? 'missing';
    }

    // smartName (FR-31)
    const sourceCommon = source.common as unknown as Record<string, unknown>;
    const targetCommon = (target?.common ?? {}) as Record<string, unknown>;
    if ((options.copySmartName ?? true) && !isEmpty(sourceCommon.smartName)) {
        plan.targetCommon.smartName = structuredClone(sourceCommon.smartName);
    }

    // common attributes (FR-33) - only if empty at the target
    for (const attr of options.copyCommon ?? []) {
        if (!isEmpty(sourceCommon[attr]) && isEmpty(targetCommon[attr])) {
            plan.targetCommon[attr] = structuredClone(sourceCommon[attr]);
        }
    }

    for (const [attr, value] of Object.entries(options.commonOverrides ?? {})) {
        plan.targetCommon[attr] = value;
    }

    return plan;
}

/**
 * Collects the status of all adapter instances (SM-02)
 *
 * @param instanceObjects - all objects `system.adapter.*` of type instance
 */
export function instanceStatusMap(instanceObjects: Record<string, ioBroker.Object>): Record<string, InstanceStatus> {
    const result: Record<string, InstanceStatus> = {};
    for (const [id, obj] of Object.entries(instanceObjects)) {
        if (obj?.type !== 'instance') {
            continue;
        }
        const key = id.replace(/^system\.adapter\./, '');
        result[key] = (obj.common as ioBroker.InstanceCommon).enabled ? 'active' : 'disabled';
    }
    return result;
}

/**
 * Enum membership: which enums contain the source - the target is added, the source removed in mode 'remove'
 *
 * @param enums - all enum objects
 * @param sourceId - source ID
 * @param targetId - target ID
 * @param removeSource - remove the source from the enum
 */
export function planEnums(
    enums: Record<string, ioBroker.Object>,
    sourceId: string,
    targetId: string,
    removeSource: boolean,
): { enumId: string; members: string[] }[] {
    const changes: { enumId: string; members: string[] }[] = [];
    for (const [enumId, obj] of Object.entries(enums)) {
        const members = (obj?.common as ioBroker.EnumCommon | undefined)?.members ?? [];
        if (!members.includes(sourceId)) {
            continue;
        }
        let next = members.includes(targetId) ? [...members] : [...members, targetId];
        if (removeSource) {
            next = next.filter(m => m !== sourceId);
        }
        changes.push({ enumId, members: next });
    }
    return changes;
}
