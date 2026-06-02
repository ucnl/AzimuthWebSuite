// antenna-corrector.js — Корректор угла антенны по калибровочной таблице
// Портировано с C# AZMLib.AZMAntennaCorrector

const AntennaCorrector = (() => {

    class AZMAntennaCorrector {
        constructor() {
            this._calibrationTable = [];
        }

        /**
         * Загружает калибровочную таблицу из двух массивов
         * @param {number[]} encoderAngles — углы энкодера (градусы)
         * @param {number[]} errors — ошибки = реальный_угол - угол_энкодера (градусы)
         */
        loadCalibration(encoderAngles, errors) {
            if (encoderAngles.length !== errors.length) {
                throw new Error('Массивы должны быть одинаковой длины');
            }
            if (encoderAngles.length < 2) {
                throw new Error('Таблица должна содержать минимум 2 точки');
            }

            this._calibrationTable = [];

            for (let i = 0; i < encoderAngles.length; i++) {
                const normalizedAngle = this._normalizeAngle(encoderAngles[i]);
                this._calibrationTable.push({
                    encoderAngle: normalizedAngle,
                    error: errors[i]
                });
            }

            // Сортировка по углу
            this._calibrationTable.sort((a, b) => a.encoderAngle - b.encoderAngle);

            // Виртуальная точка в конце (360° = 0°)
            const last = this._calibrationTable[this._calibrationTable.length - 1];
            if (Math.abs(last.encoderAngle - 360.0) > 0.01) {
                const firstError = this._calibrationTable[0].error;
                this._calibrationTable.push({
                    encoderAngle: 360.0,
                    error: firstError
                });
            }
        }

        /**
         * Корректирует измеренный угол
         * @param {number} measuredAngle — измеренный угол (градусы)
         * @returns {number} скорректированный угол (градусы, 0-360)
         */
        correctAngle(measuredAngle) {
            if (this._calibrationTable.length === 0) {
                return measuredAngle;
            }

            const normalizedAngle = this._normalizeAngle(measuredAngle);
            const error = this._linearInterpolation(normalizedAngle);
            const correctedAngle = normalizedAngle - error;

            return this._normalizeAngle(correctedAngle);
        }

        /**
         * Линейная интерполяция ошибки по углу
         * @param {number} angle — нормализованный угол
         * @returns {number} интерполированная ошибка
         */
        _linearInterpolation(angle) {
            let index = 0;
            while (index < this._calibrationTable.length && 
                   this._calibrationTable[index].encoderAngle <= angle) {
                index++;
            }

            if (index === 0) {
                return this._calibrationTable[0].error;
            }

            if (index >= this._calibrationTable.length) {
                return this._calibrationTable[this._calibrationTable.length - 1].error;
            }

            const left = this._calibrationTable[index - 1];
            const right = this._calibrationTable[index];

            const t = (angle - left.encoderAngle) / (right.encoderAngle - left.encoderAngle);
            return left.error + t * (right.error - left.error);
        }

        /**
         * Нормализация угла в диапазон [0, 360)
         * @param {number} angle — угол в градусах
         * @returns {number} нормализованный угол
         */
        _normalizeAngle(angle) {
            angle = angle % 360.0;
            if (angle < 0) angle += 360.0;
            return angle;
        }

        /**
         * Очищает калибровочную таблицу
         */
        reset() {
            this._calibrationTable = [];
        }

        /**
         * Возвращает true, если таблица загружена
         */
        get isCalibrated() {
            return this._calibrationTable.length >= 2;
        }
    }

    // ========== ФУНКЦИИ ДЛЯ РАБОТЫ С ФАЙЛАМИ ==========

    /**
     * Загружает калибровочную таблицу из текста (CSV/TSV)
     * @param {string} text — содержимое файла
     * @returns {{ angles: number[], errors: number[] }}
     */
    function parseFromText(text) {
        const lines = text.split(/\r?\n/);
        const angles = [];
        const errors = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum].trim();
            if (line === '' || line.startsWith('#')) continue;

            const parts = line.split(/[;,\t]/).map(s => s.trim()).filter(s => s !== '');
            if (parts.length < 2) {
                throw new Error(`Строка ${lineNum + 1}: ожидается 2 колонки`);
            }

            const angle = parseFloat(parts[0]);
            const error = parseFloat(parts[1]);

            if (isNaN(angle) || isNaN(error)) {
                throw new Error(`Строка ${lineNum + 1}: неверный формат чисел`);
            }

            angles.push(angle);
            errors.push(error);
        }

        if (angles.length < 2) {
            throw new Error(`Недостаточно точек: ${angles.length}`);
        }

        return { angles, errors };
    }

    /**
     * Формирует текст калибровочного файла
     * @param {number[]} angles — углы энкодера
     * @param {number[]} errors — ошибки
     * @returns {string} содержимое CSV
     */
    function formatToText(angles, errors) {
        const lines = ['# Angle_deg;Error_deg'];
        for (let i = 0; i < angles.length; i++) {
            lines.push(`${angles[i].toFixed(3)};${errors[i].toFixed(6)}`);
        }
        return lines.join('\n');
    }

    /**
     * Скачивает калибровочный файл
     * @param {number[]} angles 
     * @param {number[]} errors 
     * @param {string} filename 
     */
    function downloadCalibrationFile(angles, errors, filename) {
        const text = formatToText(angles, errors);
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'antenna_calibration.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return {
        AZMAntennaCorrector,
        parseFromText,
        formatToText,
        downloadCalibrationFile
    };

})();