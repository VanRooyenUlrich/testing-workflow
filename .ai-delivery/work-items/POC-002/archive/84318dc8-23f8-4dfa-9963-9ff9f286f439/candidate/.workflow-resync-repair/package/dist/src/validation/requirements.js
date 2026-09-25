/** The single gate definition used by validation, review, delivery, and completion. */
export function requiredCommandIds(governance) {
    return [...new Set([
            ...governance.validation.requiredCommands,
            ...Object.entries(governance.commands)
                .filter(([, definition]) => definition.isolation?.requiredForReview === true)
                .map(([id]) => id),
        ])].sort();
}
export function missingRequiredCommands(governance, passed) {
    const completed = new Set(passed);
    return requiredCommandIds(governance).filter((id) => !completed.has(id));
}
//# sourceMappingURL=requirements.js.map