// modules/ui-wizard.js — Стартовый мастер настройки

const UIWizard = (() => {
    let overlay, modal, title, body, buttons;
    let currentStepIndex = 0;
    let wizardState = {};
    let onComplete = null;
	let isFinishing = false;

    const STEPS = [
        {
            id: 'antenna_mode',
            titleKey: 'module.wizard.antennaTitle',
            render: (state) => `
                <p style="text-align:center; color:var(--text-primary); margin-bottom:16px;">
                    <span data-i18n="module.wizard.fixedQuestion">${I18n.html('module.wizard.fixedQuestion')}</span>
                </p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${!state.moving ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${!state.moving ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-moving" value="fixed" ${!state.moving ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong><span data-i18n="module.wizard.fixed">${I18n.html('module.wizard.fixed')}</span></strong><br>
                            <small style="color:var(--text-secondary);"><span data-i18n="module.wizard.fixedHint">${I18n.html('module.wizard.fixedHint')}</span></small>
                        </div>
                    </label>
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${state.moving ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${state.moving ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-moving" value="moving" ${state.moving ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong><span data-i18n="module.wizard.moving">${I18n.html('module.wizard.moving')}</span></strong><br>
                            <small style="color:var(--text-secondary);"><span data-i18n="module.wizard.movingHint">${I18n.html('module.wizard.movingHint')}</span></small>
                        </div>
                    </label>
                </div>
            `,
            buttons: (state, stepIdx, totalSteps) => `
                <button class="wiz-btn wiz-btn-skip" data-action="skip"><span data-i18n="module.wizard.skip">${I18n.html('module.wizard.skip')}</span></button>
                <span style="color:var(--text-secondary);font-size:11px;">${stepIdx + 1}/${totalSteps}</span>
                <button class="wiz-btn wiz-btn-next" data-action="next"><span data-i18n="module.wizard.next">${I18n.html('module.wizard.next')}</span></button>
            `,
            getState: () => {
                const el = document.querySelector('input[name="wiz-moving"]:checked');
                return { moving: el ? el.value === 'moving' : false };
            }
        },
		{
            id: 'reference_mode',
            titleKey: 'module.wizard.referenceTitle',
            render: (state) => `
                <p style="text-align:center; color:var(--text-primary); margin-bottom:12px;">
                    <span data-i18n="module.wizard.referenceQuestion">${I18n.html('module.wizard.referenceQuestion')}</span>
                </p>
                <p style="text-align:center; color:var(--text-secondary); font-size:11px; margin-bottom:16px;">
                    <span data-i18n="module.wizard.referenceDescription">${I18n.html('module.wizard.referenceDescription')}</span>
                </p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${!state.useReferenceBeacons ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${!state.useReferenceBeacons ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-use-ref" value="no" ${!state.useReferenceBeacons ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong><span data-i18n="module.wizard.no">${I18n.html('module.wizard.no')}</span></strong><br>
                            <small style="color:var(--text-secondary);"><span data-i18n="module.wizard.normalHint">${I18n.html('module.wizard.normalHint')}</span></small>
                        </div>
                    </label>
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${state.useReferenceBeacons ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${state.useReferenceBeacons ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-use-ref" value="yes" ${state.useReferenceBeacons ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong><span data-i18n="module.wizard.referenceYes">${I18n.html('module.wizard.referenceYes')}</span></strong><br>
                            <small style="color:var(--text-secondary);"><span data-i18n="module.wizard.referenceHint">${I18n.html('module.wizard.referenceHint')}</span></small>
                        </div>
                    </label>
                </div>
            `,
            buttons: (state, stepIdx, totalSteps) => `
                <button class="wiz-btn wiz-btn-back" data-action="back"><span data-i18n="module.wizard.back">${I18n.html('module.wizard.back')}</span></button>
                <span style="color:var(--text-secondary);font-size:11px;">${stepIdx + 1}/${totalSteps}</span>
                ${state.useReferenceBeacons 
                    ? `<button class="wiz-btn wiz-btn-finish" data-action="finish"><span data-i18n="module.wizard.finish">${I18n.html('module.wizard.finish')}</span></button>`
                    : `<button class="wiz-btn wiz-btn-next" data-action="next"><span data-i18n="module.wizard.next">${I18n.html('module.wizard.next')}</span></button>`
                }
            `,
            getState: () => {
                const el = document.querySelector('input[name="wiz-use-ref"]:checked');
                return { useReferenceBeacons: el ? el.value === 'yes' : false };
            },
            onRender: () => {
				document.querySelectorAll('input[name="wiz-use-ref"]').forEach(radio => {
					radio.onchange = () => {
						const state = document.querySelector('input[name="wiz-use-ref"]:checked')?.value === 'yes';
						wizardState.useReferenceBeacons = state;
						
						// Запоминаем состояние чекбокса "больше не показывать"
						const dontShowEl = document.getElementById('wizard-dont-show');
						const dontShowChecked = dontShowEl ? dontShowEl.checked : false;
						
						renderStep();
						
						// Восстанавливаем
						const newDontShowEl = document.getElementById('wizard-dont-show');
						if (newDontShowEl && dontShowChecked) {
							newDontShowEl.checked = true;
						}
					};
				});
			}
        },
        {
            id: 'topo',
            titleKey: 'module.wizard.topoTitle',
            render: (state) => `
                <p style="text-align:center; color:var(--text-primary); margin-bottom:16px;">
                    <span data-i18n="module.wizard.topoQuestion">${I18n.html('module.wizard.topoQuestion')}</span>
                </p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${!state.hasTopo ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${!state.hasTopo ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-has-topo" value="no" ${!state.hasTopo ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong><span data-i18n="module.wizard.no">${I18n.html('module.wizard.no')}</span></strong><br>
                            <small style="color:var(--text-secondary);"><span data-i18n="module.wizard.cartesianHint">${I18n.html('module.wizard.cartesianHint')}</span></small>
                        </div>
                    </label>
                    <label style="display:flex; align-items:center; padding:12px; border:2px solid ${state.hasTopo ? 'var(--border-accent)' : 'var(--border-primary)'}; border-radius:8px; cursor:pointer; background:${state.hasTopo ? 'var(--bg-tertiary)' : 'transparent'};">
                        <input type="radio" name="wiz-has-topo" value="yes" ${state.hasTopo ? 'checked' : ''} style="margin-right:10px;">
                        <div>
                            <strong><span data-i18n="module.wizard.topoYes">${I18n.html('module.wizard.topoYes')}</span></strong><br>
                            <small style="color:var(--text-secondary);"><span data-i18n="module.wizard.topoHint">${I18n.html('module.wizard.topoHint')}</span></small>
                        </div>
                    </label>
                </div>
            `,
            buttons: (state, stepIdx, totalSteps) => `
                <button class="wiz-btn wiz-btn-back" data-action="back"><span data-i18n="module.wizard.back">${I18n.html('module.wizard.back')}</span></button>
                <span style="color:var(--text-secondary);font-size:11px;">${stepIdx + 1}/${totalSteps}</span>
                <button class="wiz-btn wiz-btn-finish" data-action="finish"><span data-i18n="module.wizard.finish">${I18n.html('module.wizard.finish')}</span></button>
            `,
            getState: () => {
                const el = document.querySelector('input[name="wiz-has-topo"]:checked');
                return { hasTopo: el ? el.value === 'yes' : false };
            }
        },
        {
            id: 'gnss',
            titleKey: 'module.wizard.gnssTitle',
            render: (state) => {
                let saved = null;
                try { saved = localStorage.getItem('zima2_settings'); } catch (e) {}
                let gnssBaud = 38400;
                if (saved) {
                    try { gnssBaud = JSON.parse(saved).gnssBaudrate || 38400; } catch (e) {}
                }
                const baudRates = [4800, 9600, 19200, 38400, 57600, 115200];
                const options = baudRates.map(b => `<option value="${b}" ${b === gnssBaud ? 'selected' : ''}>${b}</option>`).join('');
                
                return `
                    <p style="text-align:center; color:var(--text-primary); margin-bottom:12px;">
                        <span data-i18n="module.wizard.movingCompass">${I18n.html('module.wizard.movingCompass')}</span>
                    </p>
                    <div class="topo-row">
                        <label><span data-i18n="module.wizard.baud">${I18n.html('module.wizard.baud')}</span></label>
                        <select id="wiz-gnss-baud" style="flex:1; padding:6px 8px; border:1px solid var(--border-primary); border-radius:var(--radius-sm); background:var(--bg-input); color:var(--text-primary); font-size:12px;">
                            ${options}
                        </select>
                    </div>
                    <div style="text-align:center; margin:12px 0;">
                        <button id="wiz-gnss-connect-btn" class="top-btn btn-gnss" style="font-size:12px; padding:8px 16px;">
                            <span data-i18n="module.wizard.connect">${I18n.html('module.wizard.connect')}</span>
                        </button>
                    </div>
                    <div id="wiz-gnss-status" style="text-align:center; font-size:12px; color:var(--text-secondary); min-height:18px;">
                        <span data-i18n="module.wizard.disconnected">${I18n.html('module.wizard.disconnected')}</span>
                    </div>
                `;
            },
            buttons: (state, stepIdx, totalSteps) => `
                <button class="wiz-btn wiz-btn-back" data-action="back"><span data-i18n="module.wizard.back">${I18n.html('module.wizard.back')}</span></button>
                <span style="color:var(--text-secondary);font-size:11px;">${stepIdx + 1}/${totalSteps}</span>
                <button class="wiz-btn wiz-btn-finish" data-action="finish"><span data-i18n="module.wizard.finish">${I18n.html('module.wizard.finish')}</span></button>
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
						
						I18n.bindText(statusEl, 'module.wizard.connecting');
						statusEl.style.color = 'var(--status-warning)';
						
						try {
							if (typeof App !== 'undefined' && App.connectGNSS) {
								await App.connectGNSS();
								
								// Даём время на установку соединения
								await new Promise(resolve => setTimeout(resolve, 800));
								
								if (typeof App !== 'undefined' && App.isGNSSConnected && App.isGNSSConnected()) {
									I18n.bindText(statusEl, 'module.wizard.connected');
									statusEl.style.color = 'var(--status-success)';
								} else {
									I18n.bindText(statusEl, 'module.wizard.notConnected');
									statusEl.style.color = 'var(--status-error)';
								}
							}
						} catch (e) {
							I18n.bindText(statusEl, 'module.wizard.error', { error: e.message });
							statusEl.style.color = 'var(--status-error)';
						}
					};
				}
			}
        }
    ];

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
        let skip = null;
        try { skip = localStorage.getItem('wizard_skip'); } catch (e) {}
        if (!skip) {
            show();
        }
    }

	function show() {
		if (!overlay) return;
		currentStepIndex = 0;
		isFinishing = false;   // ← сброс флага
		wizardState = { moving: false, hasTopo: false, useReferenceBeacons: false };
		overlay.style.display = 'flex';
		
		renderStep();
	}

    function hide() {
        if (!overlay) return;
        overlay.style.display = 'none';
        
        const dontShow = document.getElementById('wizard-dont-show')?.checked;
        if (dontShow) {
            try { localStorage.setItem('wizard_skip', '1'); } catch (e) {}
        }
        
        if (onComplete) {
            onComplete(wizardState);
        }
    }

    function getActiveStepsForState() {
        const active = [STEPS[0]]; // antenna_mode всегда первый
        
        // Всегда показываем вопрос про опорные маяки
        active.push(STEPS[1]); // reference_mode
        
        // Если выбрали опорные маяки — заканчиваем на этом шаге
        if (wizardState.useReferenceBeacons) {
            return active;
        }
        
        // Иначе — идём по старой логике
        if (!wizardState.moving) {
            active.push(STEPS[2]); // topo
        } else {
            active.push(STEPS[3]); // gnss
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
        
        I18n.bindText(title, step.titleKey);
        body.innerHTML = step.render(wizardState);
        
        // Кнопка "больше не показывать" на последнем шаге
        const isLast = currentStepIndex === activeSteps.length - 1;
        const dontShowHtml = isLast ? `
            <label style="display:flex; align-items:center; cursor:pointer; font-size:12px; color:var(--text-secondary); margin-top:8px;">
                <input type="checkbox" id="wizard-dont-show" style="margin-right:8px;">
                <span data-i18n="module.wizard.dontShow">${I18n.html('module.wizard.dontShow')}</span>
            </label>
        ` : '';
        
        body.innerHTML += dontShowHtml;
        buttons.innerHTML = step.buttons(wizardState, currentStepIndex, activeSteps.length);
        I18n.apply(body);
        I18n.apply(buttons);
        
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
		if (isFinishing) return;   // ← защита
		isFinishing = true;
		
		const activeSteps = getActiveStepsForState();
		const step = activeSteps[currentStepIndex];
		
		// Сохраняем состояние последнего шага
		if (step && step.getState) {
			wizardState = { ...wizardState, ...step.getState() };
		}
		
		hide();
	}

    function resetWizard() {
        try { localStorage.removeItem('wizard_skip'); } catch (e) {}
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
