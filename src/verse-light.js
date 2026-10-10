// Wraps each word under root in an inline span so light can read across the verse word by word.
// Inline (never inline-block): no new break opportunities inside words and kerning stays intact at display size.
// Whitespace stays as text; ancestry such as .lord and .verse-key is kept. Idempotent.
export function wrapWords(root) {
  if (!root) return [];
  if (root.__words) return root.__words;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.textContent.trim()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { fragment.append(part); continue; }
      const word = document.createElement('span');
      word.className = 'verse-word';
      word.textContent = part;
      fragment.append(word);
    }
    node.replaceWith(fragment);
  }
  return (root.__words = [...root.querySelectorAll('.verse-word')]);
}
