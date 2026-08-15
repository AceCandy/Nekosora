const UNICODE_LETTER = /\p{L}/u;

export function memorySignalIndex(text: string): number {
  return text.search(UNICODE_LETTER);
}

/** 只有包含 Unicode 字母的文本才值得进入自动长期记忆流程。 */
export function isMemoryEligibleText(text: string): boolean {
  return memorySignalIndex(text) >= 0;
}
