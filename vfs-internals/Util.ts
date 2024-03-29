export abstract class Util {
  /**
   * Escape a string to be used in a regular expression.
   */
  public static escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
  }

  /**
   * Trim quotes from a string.
   */
  public static trimQuotes(str: string): string {
    return str.replace(/^(["'])(.*)\1$/, "$2");
  }
}
