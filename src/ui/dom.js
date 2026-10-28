export const byId = (id) => document.getElementById(id);

export function el(tag, text = "", className = "") {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
}

// Event handlers must not leak sync throws or rejections; route both to onError.
export const reportErrors =
    (onError) =>
    (action) =>
    (...args) =>
        Promise.resolve()
            .then(() => action(...args))
            .catch(onError);

export function download(blob, name) {
    const url = URL.createObjectURL(blob),
        link = el("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
