// Minimal protobuf wire reader for Bilibili SEND_GIFT_V2 frames.
// Adapted from Cortico (MIT): https://github.com/Pal-AI-Lab/Cortico
const decoder = new TextDecoder('utf-8', { fatal: true });

function decode(buffer) {
    const fields = [];
    let offset = 0;
    while (offset < buffer.length) {
        const key = readVarint(buffer, offset);
        if (!key) return null;
        offset = key.next;
        const field = Number(key.value >> 3n);
        const wire = Number(key.value & 7n);
        if (field <= 0) return null;
        if (wire === 0) {
            const value = readVarint(buffer, offset);
            if (!value) return null;
            fields.push({ field, wire, varint: value.value });
            offset = value.next;
        } else if (wire === 2) {
            const length = readVarint(buffer, offset);
            if (!length) return null;
            const end = length.next + Number(length.value);
            if (!Number.isSafeInteger(end) || end > buffer.length) return null;
            fields.push({ field, wire, bytes: buffer.subarray(length.next, end) });
            offset = end;
        } else if (wire === 1 || wire === 5) {
            const width = wire === 1 ? 8 : 4;
            if (offset + width > buffer.length) return null;
            fields.push({ field, wire, bytes: buffer.subarray(offset, offset + width) });
            offset += width;
        } else return null;
    }
    return fields;
}

function fromBase64(value) {
    if (typeof value !== 'string' || !value) return null;
    const bytes = Buffer.from(value, 'base64');
    return bytes.length ? decode(bytes) : null;
}

function pick(fields, field) {
    if (!fields) return undefined;
    for (let index = fields.length - 1; index >= 0; index--) {
        if (fields[index].field === field) return fields[index];
    }
    return undefined;
}

function sub(fields, field) {
    const bytes = pick(fields, field)?.bytes;
    return bytes ? decode(bytes) : null;
}

function text(fields, field) {
    const bytes = pick(fields, field)?.bytes;
    if (!bytes) return '';
    try {
        const value = decoder.decode(bytes);
        return [...value].some(char => char.charCodeAt(0) < 0x20) ? '' : value;
    } catch (_) { return ''; }
}

function integer(fields, field) {
    const value = pick(fields, field)?.varint;
    if (value === undefined) return undefined;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
}

function readVarint(buffer, start) {
    let value = 0n;
    let shift = 0n;
    for (let index = start; index < buffer.length && index - start < 10; index++) {
        const byte = buffer[index];
        value |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return { value, next: index + 1 };
        shift += 7n;
    }
    return null;
}

module.exports = { fromBase64, sub, text, integer };
