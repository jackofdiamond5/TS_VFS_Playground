export abstract class Util {
    /**
     * Escape a string to be used in a regular expression.
     */
    public static escapeRegExp(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
    }
}
