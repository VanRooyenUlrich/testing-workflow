export function globMatches(value, pattern) {
    const normalizedValue = value.replace(/\\/g, '/').replace(/^\.\//, '');
    const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
    let expression = '';
    for (let index = 0; index < normalizedPattern.length; index += 1) {
        const character = normalizedPattern[index];
        if (character === '*' && normalizedPattern[index + 1] === '*') {
            index += 1;
            if (normalizedPattern[index + 1] === '/') {
                index += 1;
                expression += '(?:.*/)?';
            }
            else
                expression += '.*';
        }
        else if (character === '*')
            expression += '[^/]*';
        else if (character === '?')
            expression += '[^/]';
        else
            expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${expression}$`, 'i').test(normalizedValue);
}
//# sourceMappingURL=glob.js.map