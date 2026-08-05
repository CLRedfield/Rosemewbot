export async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    const copiedByDesktop = await window.rosemewbotDesktop?.copyText(value);
    if (copiedByDesktop) return true;
  } catch {
    // Fall through to browser clipboard strategies.
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Some local and non-secure browser contexts expose the API but reject writes.
  }

  const textarea = document.createElement("textarea");
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previouslyFocused?.focus();
  }
}
