// modules/ui-wizard.js — Стартовый мастер настройки

const UIWizard = (() => {
    let overlay, modal, title, body, buttons;
    let currentStepIndex = 0;
    let wizardState = {};
    let onComplete = null;

    const STEPS = [
        {
            id: 'antenna_mode',
            title: 'Режим антенны',
            render: (state) => `
                <p style="text-align:center; color:var(--text-primary); margin-bottom:16px;">
                    Антенна неподвижна?
                </p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${!state.moving ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${!state.moving ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-moving" value="fixed" ${!state.moving ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong>Неподвижна</strong><br>
                            <small style="color:var(--text-secondary);">Пирс, зафиксированное судно</small>
                        </div>
                    </label>
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${state.moving ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${state.moving ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-moving" value="moving" ${state.moving ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong>Движется</strong><br>
                            <small style="color:var(--text-secondary);">Катер, буй</small>
                        </div>
                    </label>
                </div>
            `,
            buttons: (state, stepIdx, totalSteps) => `
                <button class="wiz-btn wiz-btn-skip" data-action="skip">✕ Пропустить</button>
                <span style="color:var(--text-secondary);font-size:11px;">${stepIdx + 1}/${totalSteps}</span>
                <button class="wiz-btn wiz-btn-next" data-action="next">Далее →</button>
            `,
            getState: () => {
                const el = document.querySelector('input[name="wiz-moving"]:checked');
                return { moving: el ? el.value === 'moving' : false };
            }
        },
        {
            id: 'topo',
            title: 'Координаты антенны',
            showCondition: (state) => !state.moving,
            render: (state) => `
                <p style="text-align:center; color:var(--text-primary); margin-bottom:16px;">
                    Знаете координаты и курс антенны?
                </p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${!state.hasTopo ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${!state.hasTopo ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-has-topo" value="no" ${!state.hasTopo ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong>Нет</strong><br>
                            <small style="color:var(--text-secondary);">Работа в метрах X,Y,Z от антенны</small>
                        </div>
                    </label>
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${state.hasTopo ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${state.hasTopo ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-has-topo" value="yes" ${state.hasTopo ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong>Да, сейчас введу</strong><br>
                            <small style="color:var(--text-secondary);">Будут доступны географические координаты</small>
                        </div>
                    </label>
                </div>
            `,
            buttons: (state, stepIdx, totalSteps) => `
                <button class="wiz-btn wiz-btn-back" data-action="back">← Назад</button>
                <span style="color:var(--text-secondary);font-size:11px;">${stepIdx + 1}/${totalSteps}</span>
                <button class="wiz-btn wiz-btn-finish" data-action="finish">Готово ✓</button>
            `,
            getState: () => {
                const el = document.querySelector('input[name="wiz-has-topo"]:checked');
                return { hasTopo: el ? el.value === 'yes' : false };
            }
        },
        {
            id: 'gnss',
            title: 'Подключение GNSS-компаса',
            showCondition: (state) => state.moving,
            render: (state) => {
                const saved = localStorage.getItem('zima2_settings');
                let gnssBaud = 38400;
                if (saved) {
                    try { gnssBaud = JSON.parse(saved).gnssBaudrate || 38400; } catch (e) {}
                }
                const baudRates = [4800, 9600, 19200, 38400, 57600, 115200];
                const options = baudRates.map(b => `<option value="${b}" ${b === gnssBaud ? 'selected' : ''}>${b}</option>`).join('');
                
                return `
                    <p style="text-align:center; color:var(--text-primary); margin-bottom:12px;">
                        Антенна движется — нужен внешний компас.
                    </p>
                    <div class="topo-row">
                        <label>Скорость порта:</label>
                        <select id="wiz-gnss-baud" style="flex:1; padding:6px 8px; border:1px solid var(--border-primary); border-radius:var(--radius-sm); background:var(--bg-input); color:var(--text-primary); font-size:12px;">
                            ${options}
                        </select>
                    </div>
                    <div style="text-align:center; margin:12px 0;">
                        <button id="wiz-gnss-connect-btn" class="top-btn btn-gnss" style="font-size:12px; padding:8px 16px;">
                            📡 Подключить и проверить
                        </button>
                    </div>
                    <div id="wiz-gnss-status" style="text-align:center; font-size:12px; color:var(--text-secondary); min-height:18px;">
                        Не подключен
                    </div>
                `;
            },
            buttons: (state, stepIdx, totalSteps) => `
                <button class="wiz-btn wiz-btn-back" data-action="back">← Назад</button>
                <span style="color:var(--text-secondary);font-size:11px;">${stepIdx + 1}/${totalSteps}</span>
                <button class="wiz-btn wiz-btn-finish" data-action="finish">Готово ✓</button>
            `,
            getState: () => {
                const baudEl = document.getElementById('wiz-gnss-baud');
                return { gnssBaud: baudEl ? parseInt(baudEl.value) : 38400 };
            },
            onRender: () => {
				const btn = document.getElementById('wiz-gnss-connect-btn');
				const statusEl = document.getElementById('wiz-gnss-status');
				if (btn && statusEl) {
					btn.onclick = async () => {
						const baud = parseInt(document.getElementById('wiz-gnss-baud')?.value) || 38400;
						
						// Сохраняем скорость
						try {
							const saved = localStorage.getItem('zima2_settings');
							const data = saved ? JSON.parse(saved) : {};
							data.gnssBaudrate = baud;
							localStorage.setItem('zima2_settings', JSON.stringify(data));
						} catch (e) {}
						
						statusEl.textContent = '⏳ Подключение...';
						statusEl.style.color = 'var(--status-warning)';
						
						try {
							if (typeof App !== 'undefined' && App.connectGNSS) {
								await App.connectGNSS();
								
								// Даём время на установку соединения
								await new Promise(resolve => setTimeout(resolve, 800));
								
								if (typeof App !== 'undefined' && App.isGNSSConnected && App.isGNSSConnected()) {
									statusEl.textContent = '✓ Подключен';
									statusEl.style.color = 'var(--status-success)';
								} else {
									statusEl.textContent = '✗ Не подключен';
									statusEl.style.color = 'var(--status-error)';
								}
							}
						} catch (e) {
							statusEl.textContent = '✗ Ошибка: ' + e.message;
							statusEl.style.color = 'var(--status-error)';
						}
					};
				}
			}
        }
    ];

    function getActiveSteps() {
        const steps = [];
        let state = {};
        
        // Проходим по шагам и собираем активные
        for (const step of STEPS) {
            if (step.id === 'antenna_mode') {
                steps.push(step);
                continue;
            }
            if (step.showCondition && step.showCondition(wizardState)) {
                steps.push(step);
            }
            if (step.id === 'antenna_mode') {
                state = { ...state, ...step.getState() };
            }
        }
        
        return steps;
    }

    function init(callbacks) {
        overlay = document.getElementById('wizard-overlay');
        modal = document.getElementById('wizard-modal');
        title = document.getElementById('wizard-title');
        body = document.getElementById('wizard-body');
        buttons = document.getElementById('wizard-buttons');
        
        if (callbacks && callbacks.onComplete) {
            onComplete = callbacks.onComplete;
        }
        
        // Проверяем, нужно ли показывать мастер
        const skip = localStorage.getItem('wizard_skip');
        if (!skip) {
            show();
        }
    }

    function show() {
        if (!overlay) return;
        currentStepIndex = 0;
        wizardState = { moving: false, hasTopo: false, gnssBaud: 38400 };
        overlay.style.display = 'flex';
        
        // Определяем активные шаги на основе начального состояния
        renderStep();
    }

    function hide() {
        if (!overlay) return;
        overlay.style.display = 'none';
        
        const dontShow = document.getElementById('wizard-dont-show')?.checked;
        if (dontShow) {
            localStorage.setItem('wizard_skip', '1');
        }
        
        if (onComplete) {
            onComplete(wizardState);
        }
    }

    function getActiveStepsForState() {
        const active = [STEPS[0]]; // antenna_mode всегда первый
        
        if (!wizardState.moving) {
            active.push(STEPS[1]); // topo
        } else {
            active.push(STEPS[2]); // gnss
        }
        
        return active;
    }

    function renderStep() {
        const activeSteps = getActiveStepsForState();
        const step = activeSteps[currentStepIndex];
        
        if (!step) {
            finish();
            return;
        }
        
        title.textContent = '⚙ ' + step.title;
        body.innerHTML = step.render(wizardState);
        
        // Кнопка "больше не показывать" на последнем шаге
        const isLast = currentStepIndex === activeSteps.length - 1;
        const dontShowHtml = isLast ? `
            <label style="display:flex; align-items:center; cursor:pointer; font-size:12px; color:var(--text-secondary); margin-top:8px;">
                <input type="checkbox" id="wizard-dont-show" style="margin-right:8px;">
                Больше не показывать
            </label>
        ` : '';
        
        body.innerHTML += dontShowHtml;
        buttons.innerHTML = step.buttons(wizardState, currentStepIndex, activeSteps.length);
        
        // Навешиваем обработчики
        buttons.querySelectorAll('button').forEach(btn => {
            btn.onclick = () => {
                const action = btn.dataset.action;
                if (action === 'next') nextStep();
                else if (action === 'back') prevStep();
                else if (action === 'finish') finish();
                else if (action === 'skip') hide();
            };
        });
        
        // Вызываем onRender если есть
        if (step.onRender) {
            setTimeout(() => step.onRender(), 50);
        }
    }

    function nextStep() {
        const activeSteps = getActiveStepsForState();
        const step = activeSteps[currentStepIndex];
        
        // Сохраняем состояние шага
        if (step.getState) {
            wizardState = { ...wizardState, ...step.getState() };
        }
        
        // Если изменился moving — пересчитываем активные шаги
        if (step.id === 'antenna_mode') {
            currentStepIndex = 0;
        }
        
        currentStepIndex++;
        
        const newActiveSteps = getActiveStepsForState();
        if (currentStepIndex >= newActiveSteps.length) {
            finish();
            return;
        }
        
        renderStep();
    }

    function prevStep() {
        if (currentStepIndex > 0) {
            currentStepIndex--;
        }
        renderStep();
    }

    function finish() {
        const activeSteps = getActiveStepsForState();
        const step = activeSteps[currentStepIndex];
        
        // Сохраняем состояние последнего шага
        if (step && step.getState) {
            wizardState = { ...wizardState, ...step.getState() };
        }
        
        hide();
    }

    function resetWizard() {
        localStorage.removeItem('wizard_skip');
    }

    return {
        init,
        show,
        hide,
        resetWizard
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIWizard;
}