export function greet(name) {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new TypeError('A name is required');
  }

  return `Hello, ${normalizedName}!`;
}
