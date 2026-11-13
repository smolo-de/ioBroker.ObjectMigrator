/**
 * Only the admin (the tab) may control the migrator - it changes objects of all adapters
 *
 * @param from - sender of a message
 */
export function isAllowedSender(from: string | undefined): boolean {
    return typeof from === 'string' && /^system\.adapter\.admin\.\d+$/.test(from);
}
