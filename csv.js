// csv.js — Общий CSV parser/escaper (RFC 4180-совместимый)
const CSVUtils = (() => {

    /**
     * Парсит CSV-строку в массив полей.
     * Поддерживает quoted fields с запятыми, кавычками ("" → "), newlines.
     * @param {string} line — одна строка CSV
     * @param {string} delimiter — разделитель (по умолчанию ',')
     * @returns {string[]}
     */
    function parseLine(line, delimiter = ',') {
        const fields = [];
        let cur = '';
        let inQuotes = false;
        let i = 0;

        while (i < line.length) {
            const ch = line[i];

            if (inQuotes) {
                if (ch === '"') {
                    if (line[i + 1] === '"') {
                        cur += '"';
                        i += 2;
                    } else {
                        inQuotes = false;
                        i++;
                    }
                } else {
                    cur += ch;
                    i++;
                }
            } else {
                if (ch === '"' && cur === '') {
                    inQuotes = true;
                    i++;
                } else if (ch === delimiter) {
                    fields.push(cur);
                    cur = '';
                    i++;
                } else {
                    cur += ch;
                    i++;
                }
            }
        }
        fields.push(cur);
        return fields;
    }

    /**
     * Парсит многострочный CSV в массив строк (массивов полей).
     * Учитывает quoted newlines.
     */
    function parseText(text, delimiter = ',') {
        const rows = [];
        let cur = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];

            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') {
                        cur += '""';
                        i++;
                    } else {
                        inQuotes = false;
                        cur += ch;
                    }
                } else {
                    cur += ch;
                }
            } else {
                if (ch === '"' && cur.trim() === '') {
                    inQuotes = true;
                    cur = '';   // убираем пробелы перед кавычкой
                } else if (ch === '\n') {
                    rows.push(parseLine(cur, delimiter));
                    cur = '';
                } else if (ch === '\r') {
                    // пропускаем, обработаем \n
                } else {
                    cur += ch;
                }
            }
        }
        if (cur.length > 0) rows.push(parseLine(cur, delimiter));
        return rows;
    }

    /**
     * Экранирует одно поле для CSV.
     * Если содержит delimiter, quote, newline или \r — оборачивает в кавычки.
     */
    function escapeField(value, delimiter = ',') {
        const s = String(value == null ? '' : value);
        if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    /**
     * Формирует CSV-строку из массива полей.
     */
    function formatLine(fields, delimiter = ',') {
        return fields.map(f => escapeField(f, delimiter)).join(delimiter);
    }

    return { parseLine, parseText, escapeField, formatLine };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CSVUtils;
}