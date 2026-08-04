/** Short unique ids. One implementation — this was duplicated in five
 *  modules before. Safe on both client and server (no browser APIs). */
let counter = 0;
export const uid = (prefix: string): string => `${prefix}-${Date.now()}-${counter++}`;
