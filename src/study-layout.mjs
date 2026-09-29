// Readable limits are product defaults, not a claim about an attention limit.
export function splitBounds(width, _reference = false) {
  const available = Math.max(0, Number(width) || 0) - 12;
  const primaryMin = 440;
  // One threshold for menus, native/pointer drops and every content pairing.
  // Changing the side content must not silently switch the workspace to one pane.
  const secondaryMin = 400;
  return { available, min: secondaryMin, max: Math.max(secondaryMin, available - primaryMin), canSplit: available >= primaryMin + secondaryMin };
}

export function companionWidth(width, ratio = 0.38, reference = false) {
  const bounds = splitBounds(width, reference);
  const safeRatio = Number.isFinite(ratio) ? ratio : 0.38;
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, bounds.available * safeRatio)));
}
