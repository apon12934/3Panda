// main frontend script file

let API;
if (window.location.protocol === 'file:' || (window.location.hostname.match(/localhost|127\.0\.0\.1|192\.168\./) && window.location.port !== '3000' && window.location.port !== '')) {
    API = `http://${window.location.hostname || 'localhost'}:3000/api`;
} else {
    API = window.location.origin + '/api';
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';

// ============================================================
// PREMIUM MOTION ENGINE — Scroll Reveals, Parallax, Smart Nav
// ============================================================

const MOTION_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lenisInstance = null;

/**
 * Initialize Lenis smooth scrolling if available.
 * Lenis is loaded via CDN <script> before app.js.
 */
function initLenis() {
    if (MOTION_REDUCED || typeof Lenis === 'undefined') return;

    lenisInstance = new Lenis({
        duration: 1.1,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        orientation: 'vertical',
        gestureOrientation: 'vertical',
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 2,
        autoRaf: true,
    });

    // Expose globally so popups can stop/start
    window._lenis = lenisInstance;
}

/**
 * Premium scroll reveal system with dynamic stagger.
 * Supports both [data-reveal] (new) and [data-animate] (legacy).
 */
function initScrollAnimations() {
    if (MOTION_REDUCED) {
        // Immediately reveal everything
        document.querySelectorAll('[data-reveal], [data-animate], [data-stagger]').forEach(el => {
            el.classList.add('is-revealed', 'animate-in');
        });
        return;
    }

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-revealed', 'animate-in');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.05,
        rootMargin: '0px 0px -40px 0px' // smaller margin for better mobile reliability
    });

    // expose so dynamically injected content can be observed
    window._revealObserver = revealObserver;

    // Initial pass
    refreshDynamicAnimations();
}

/**
 * Helper to refresh stagger indices and observe new elements.
 * Call this after injecting dynamic content.
 */
function refreshDynamicAnimations(container = document) {
    // Set dynamic stagger indices
    container.querySelectorAll('[data-stagger]').forEach(group => {
        Array.from(group.children).forEach((child, i) => {
            child.style.setProperty('--child-index', i);
        });
    });

    // Observe new reveal elements
    const observer = window._revealObserver;
    if (observer) {
        container.querySelectorAll('[data-reveal], [data-animate], [data-stagger]').forEach(el => {
            if (!el.classList.contains('is-revealed') && !el.classList.contains('animate-in')) {
                observer.observe(el);
            }
        });
    }
}
window.refreshDynamicAnimations = refreshDynamicAnimations;


/**
 * Parallax scroll handler.
 * Elements with data-parallax="0.15" move at 15% of scroll speed.
 */
function initParallax() {
    if (MOTION_REDUCED) return;

    const parallaxEls = document.querySelectorAll('[data-parallax]');
    if (!parallaxEls.length) return;

    const updateParallax = () => {
        const scrollY = window.scrollY;
        parallaxEls.forEach(el => {
            const speed = parseFloat(el.dataset.parallax) || 0.1;
            const rect = el.getBoundingClientRect();
            const elementCenter = rect.top + rect.height / 2;
            const viewportCenter = window.innerHeight / 2;
            const offset = (elementCenter - viewportCenter) * speed;
            el.style.transform = `translateY(${offset}px)`;
        });
    };

    // Use Lenis scroll event if available, otherwise passive scroll
    if (lenisInstance) {
        lenisInstance.on('scroll', updateParallax);
    } else {
        let parallaxTicking = false;
        window.addEventListener('scroll', () => {
            if (!parallaxTicking) {
                requestAnimationFrame(() => {
                    updateParallax();
                    parallaxTicking = false;
                });
                parallaxTicking = true;
            }
        }, { passive: true });
    }
}

/**
 * Smart navbar: glassmorphism + auto-hide on scroll down, show on scroll up.
 */
function initNavbarScroll() {
    const navbar = document.getElementById('main-navbar');
    if (!navbar) return;

    let lastScrollY = 0;
    let ticking = false;
    const HIDE_THRESHOLD = 80;

    const updateNavbar = () => {
        const scrollY = window.scrollY;

        // Glassmorphism on scroll
        if (scrollY > 20) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        // Smart auto-hide (only on longer pages, don't hide at top)
        if (scrollY > HIDE_THRESHOLD) {
            if (scrollY > lastScrollY + 5) {
                // Scrolling down → hide
                navbar.classList.add('nav-hidden');
            } else if (scrollY < lastScrollY - 5) {
                // Scrolling up → show
                navbar.classList.remove('nav-hidden');
            }
        } else {
            navbar.classList.remove('nav-hidden');
        }

        lastScrollY = scrollY;
        ticking = false;
    };

    // Use Lenis if available
    if (lenisInstance) {
        lenisInstance.on('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(updateNavbar);
                ticking = true;
            }
        });
    } else {
        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(updateNavbar);
                ticking = true;
            }
        }, { passive: true });
    }
}

/**
 * Card 3D tilt — per-element pointer events for zero-lag response.
 * Perspective sits on the card wrapper so rotations feel genuinely 3D.
 */
function initCardTilt() {
    if (MOTION_REDUCED) return;
    if (window.matchMedia('(hover: none)').matches) return;

    const SELECTOR = '.card, .stat-card, .vendor-rest-card, .carousel-card';
    const MAX_TILT = 8;   // degrees
    const LIFT    = 10;   // px rise on hover

    function attachTilt(card) {
        if (card._tiltBound) return;
        card._tiltBound = true;

        // instant transform while moving — no transition lag
        card.addEventListener('pointerenter', () => {
            card.style.transition = 'box-shadow 0.3s, transform 0.35s cubic-bezier(0.23,1,0.32,1)';
            card.style.willChange = 'transform';
        });

        card.addEventListener('pointermove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width  - 0.5;  // -0.5 → +0.5
            const y = (e.clientY - rect.top)  / rect.height - 0.5;
            const rx = -y * MAX_TILT;
            const ry =  x * MAX_TILT;
            card.style.transition = 'box-shadow 0.3s';
            card.style.transform  = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-${LIFT}px) scale(1.02)`;
        });

        card.addEventListener('pointerleave', () => {
            card.style.transition = 'transform 0.55s cubic-bezier(0.23,1,0.32,1), box-shadow 0.55s';
            card.style.transform  = '';
            card.style.willChange = 'auto';
        });
    }

    // attach to all current cards
    document.querySelectorAll(SELECTOR).forEach(attachTilt);

    // attach to future cards via mutation observer
    new MutationObserver((mutations) => {
        mutations.forEach(m => m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches(SELECTOR)) attachTilt(node);
            node.querySelectorAll && node.querySelectorAll(SELECTOR).forEach(attachTilt);
        }));
    }).observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// UNIFIED POPUP CONTROLLER — PandaPopup
// One system for all popups. Change animation here → every popup updates.
// ============================================================

const PandaPopup = {
    /**
     * Open a popup panel (and its overlay, if provided).
     * Removes .hidden, plays entrance animation via CSS.
     */
    open(panelEl, overlayEl) {
        if (!panelEl) return;
        if (overlayEl) {
            overlayEl.classList.remove('hidden', 'is-exiting');
        }
        panelEl.classList.remove('hidden', 'is-exiting');
        // Lock scroll
        if (window._lenis) window._lenis.stop();
    },

    /**
     * Close a popup panel with exit animation.
     * Adds .is-exiting, waits for animation to end, then adds .hidden.
     */
    close(panelEl, overlayEl) {
        if (!panelEl) return;
        // If already hidden, nothing to do
        if (panelEl.classList.contains('hidden')) return;

        panelEl.classList.add('is-exiting');
        if (overlayEl) overlayEl.classList.add('is-exiting');

        const cleanup = () => {
            panelEl.classList.add('hidden');
            panelEl.classList.remove('is-exiting');
            if (overlayEl) {
                overlayEl.classList.add('hidden');
                overlayEl.classList.remove('is-exiting');
            }
            // Unlock scroll
            if (window._lenis) window._lenis.start();
            panelEl.removeEventListener('animationend', cleanup);
        };

        panelEl.addEventListener('animationend', cleanup, { once: true });

        // Fallback: if animation doesn't fire (element not visible, etc), clean up after 300ms
        setTimeout(() => {
            if (panelEl.classList.contains('is-exiting')) cleanup();
        }, 300);
    }
};

window.PandaPopup = PandaPopup;

// ============================================================
// MOBILE HAMBURGER MENU
// ============================================================

function initHamburger() {
    const btn = document.getElementById('hamburger-btn');
    const links = document.getElementById('nav-links');
    if (!btn || !links) return;

    const closeMenu = () => {
        btn.classList.remove('active');
        links.classList.remove('open');
        document.body.classList.remove('menu-open');
    };

    btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        links.classList.toggle('open');
        document.body.classList.toggle('menu-open', links.classList.contains('open'));
    });

    // close menu on link click
    links.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            closeMenu();
        });
    });

    // close on outside click/tap (works with the mobile backdrop)
    document.addEventListener('click', (e) => {
        if (!links.classList.contains('open')) return;

        const clickInsideMenu = links.contains(e.target);
        const clickOnHamburger = btn.contains(e.target);
        if (!clickInsideMenu && !clickOnHamburger) {
            closeMenu();
        }
    });

    // close when switching back to desktop width
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeMenu();
        }
    });
}

function initCommonButtonLogic() {
    const viewAllPartners = document.getElementById('view-all-partners');
    if (viewAllPartners) {
        viewAllPartners.addEventListener('click', (e) => {
            e.preventDefault();
            const section = document.getElementById('restaurant-list');
            if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    const favoritesLink = document.getElementById('favorites-link');
    if (favoritesLink) {
        favoritesLink.addEventListener('click', (e) => {
            e.preventDefault();
            showMsg('Favorites feature is coming soon.');
        });
    }

    const paymentMethodsLink = document.getElementById('payment-methods-link');
    if (paymentMethodsLink) {
        paymentMethodsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showMsg('Payment methods feature is coming soon.');
        });
    }

    const forgotResetLink = document.getElementById('forgot-reset-link');
    if (forgotResetLink) {
        forgotResetLink.addEventListener('click', (e) => {
            e.preventDefault();
            showMsg('Password reset is not available yet. Please contact support.');
        });
    }

    // Fallback: avoid dead hash-links jumping to top without feedback.
    document.querySelectorAll('a[href="#"]').forEach((link) => {
        if (link.id === 'show-login' || link.id === 'view-all-partners' || link.id === 'favorites-link' || link.id === 'payment-methods-link' || link.id === 'forgot-reset-link') {
            return;
        }
        link.addEventListener('click', (e) => {
            e.preventDefault();
            showMsg('This section will be available soon.');
        });
    });
}

function initFileUploadPlaceholders() {
    const inputs = document.querySelectorAll('.file-input');
    inputs.forEach((input) => {
        const group = input.closest('.has-file-upload');
        const text = group ? group.querySelector('.file-upload-text') : null;
        if (!group || !text) return;

        const fallback = input.dataset.placeholder || 'Upload image';
        const syncText = () => {
            if (input.files && input.files.length > 0) {
                text.textContent = input.files[0].name;
                group.classList.add('has-file');
            } else {
                text.textContent = fallback;
                group.classList.remove('has-file');
            }
        };

        input.addEventListener('change', syncText);
        input.addEventListener('focus', () => group.classList.add('is-focused'));
        input.addEventListener('blur', () => group.classList.remove('is-focused'));
        syncText();
    });
}

function initCustomDropdowns() {
    const dropdownRegistry = window.__customDropdownRegistry || (window.__customDropdownRegistry = new WeakMap());

    const getPlaceholderText = (select) => {
        const label = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
        const labelText = label ? label.textContent.replace(/\s*\([^)]*\)/g, '').trim() : '';
        if (labelText) return 'Select ' + labelText.toLowerCase();
        return 'Select option';
    };

    const getDisplayText = (select) => {
        const selectedOption = select.options[select.selectedIndex] || select.options[0];
        const selectedText = selectedOption ? selectedOption.textContent.trim() : '';
        return selectedText || getPlaceholderText(select);
    };

    const closeDropdown = (dropdown) => {
        if (!dropdown) return;
        dropdown.classList.remove('is-open');
        const trigger = dropdown.querySelector('.custom-dropdown-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    };

    const closeAllDropdowns = (except) => {
        document.querySelectorAll('[data-custom-dropdown].is-open').forEach((dropdown) => {
            if (dropdown !== except) closeDropdown(dropdown);
        });
    };

    const buildMenu = (state) => {
        const { select, menu } = state;
        if (!menu) return;

        menu.innerHTML = '';
        Array.from(select.options).forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'custom-dropdown-option';
            button.dataset.value = option.value;
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
            button.textContent = option.textContent.trim() || (option.value === '' ? getPlaceholderText(select) : option.value);
            if (option.disabled) button.disabled = true;

            button.addEventListener('click', () => {
                if (button.disabled) return;
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                closeDropdown(state.dropdown);
            });

            menu.appendChild(button);
        });
    };

    const syncState = (state) => {
        const { select, dropdown, valueEl, trigger, group, menu } = state;
        if (!select || !dropdown || !valueEl || !trigger) return;

        valueEl.textContent = getDisplayText(select);
        trigger.setAttribute('aria-expanded', String(dropdown.classList.contains('is-open')));

        const isFilled = select.value !== '';
        if (group) group.classList.toggle('is-filled', isFilled);

        if (menu) {
            Array.from(menu.querySelectorAll('.custom-dropdown-option')).forEach((button) => {
                const isSelected = button.dataset.value === select.value;
                button.classList.toggle('is-selected', isSelected);
                button.setAttribute('aria-selected', String(isSelected));
            });
        }
    };

    const enhanceSelect = (select) => {
        if (!select || select.dataset.customDropdownEnhanced === 'true' || select.multiple || select.size > 1) return;

        const existingDropdown = select.closest('[data-custom-dropdown]');
        let dropdown = existingDropdown;
        let trigger = existingDropdown ? existingDropdown.querySelector('.custom-dropdown-trigger') : null;
        let valueEl = existingDropdown ? existingDropdown.querySelector('.custom-dropdown-value') : null;
        let menu = existingDropdown ? existingDropdown.querySelector('.custom-dropdown-menu') : null;

        if (!existingDropdown) {
            const parent = select.parentElement;
            if (!parent) return;

            dropdown = document.createElement('div');
            dropdown.className = 'custom-dropdown';
            dropdown.dataset.customDropdown = 'true';

            if (select.style.width === 'auto' || select.style.display === 'inline' || select.closest('.gap-row')) {
                dropdown.classList.add('custom-dropdown--inline');
            }

            parent.insertBefore(dropdown, select);
            dropdown.appendChild(select);
            select.classList.add('custom-dropdown-native');
            select.setAttribute('aria-hidden', 'true');
            select.setAttribute('tabindex', '-1');

            trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'custom-dropdown-trigger';
            trigger.setAttribute('aria-haspopup', 'listbox');
            trigger.setAttribute('aria-expanded', 'false');
            if (select.style.fontSize) trigger.style.fontSize = select.style.fontSize;

            valueEl = document.createElement('span');
            valueEl.className = 'custom-dropdown-value';

            const icon = document.createElement('span');
            icon.className = 'custom-dropdown-icon';
            icon.setAttribute('aria-hidden', 'true');

            menu = document.createElement('div');
            menu.className = 'custom-dropdown-menu';
            menu.setAttribute('role', 'listbox');
            const label = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
            if (label) menu.setAttribute('aria-label', label.textContent.trim());

            trigger.append(valueEl, icon);
            dropdown.append(trigger, menu);
        }

        const group = dropdown.parentElement;
        if (group) group.classList.add('custom-dropdown-group');

        const state = { select, dropdown, trigger, valueEl, menu, group, observer: null };
        dropdownRegistry.set(select, state);
        select.dataset.customDropdownEnhanced = 'true';

        if (!select.classList.contains('custom-dropdown-native')) {
            select.classList.add('custom-dropdown-native');
            select.setAttribute('aria-hidden', 'true');
            select.setAttribute('tabindex', '-1');
        }

        buildMenu(state);
        syncState(state);

        if (!select._customDropdownChangeBound) {
            select.addEventListener('change', () => syncState(state));
            select._customDropdownChangeBound = true;
        }

        if (trigger && !trigger._customDropdownBound) {
            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                const willOpen = !dropdown.classList.contains('is-open');
                closeAllDropdowns(dropdown);
                dropdown.classList.toggle('is-open', willOpen);
                trigger.setAttribute('aria-expanded', String(willOpen));
            });

            trigger.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    closeDropdown(dropdown);
                }
            });

            trigger._customDropdownBound = true;
        }

        if (!state.observer) {
            state.observer = new MutationObserver(() => {
                buildMenu(state);
                syncState(state);
            });
            state.observer.observe(select, { childList: true });
        }

        return state;
    };

    document.querySelectorAll('[data-custom-dropdown]').forEach((dropdown) => {
        const select = dropdown.querySelector('select');
        if (!select) return;
        enhanceSelect(select);
    });

    document.querySelectorAll('select.form-control').forEach((select) => {
        if (select.closest('[data-custom-dropdown]')) return;
        enhanceSelect(select);
    });

    if (!window.__customDropdownOutsideClickBound) {
        document.addEventListener('click', (event) => {
            if (!event.target.closest('[data-custom-dropdown]')) {
                closeAllDropdowns();
            }
        });
        window.__customDropdownOutsideClickBound = true;
    }

    window.refreshCustomDropdown = (selectOrId) => {
        const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
        if (!select) return;
        const state = dropdownRegistry.get(select);
        if (!state) {
            enhanceSelect(select);
            return;
        }
        buildMenu(state);
        syncState(state);
    };

    // Expose enhanceSelect globally so it can be called on dynamically added selects
    window._enhanceSelect = enhanceSelect;

    // Auto-enhance dynamically added selects (e.g. cloned from <template>)
    if (!window.__customDropdownMutationBound) {
        new MutationObserver((mutations) => {
            mutations.forEach(m => m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                // Enhance the node itself if it's a select
                if (node.matches && node.matches('select.form-control') && !node.closest('[data-custom-dropdown]')) {
                    enhanceSelect(node);
                }
                // Enhance any select.form-control descendants
                if (node.querySelectorAll) {
                    node.querySelectorAll('select.form-control').forEach(sel => {
                        if (!sel.closest('[data-custom-dropdown]')) enhanceSelect(sel);
                    });
                }
            }));
        }).observe(document.body, { childList: true, subtree: true });
        window.__customDropdownMutationBound = true;
    }
}

// small helper functions

const getToken = () => localStorage.getItem('token');
const getRole  = () => (localStorage.getItem('role') || '').trim().toLowerCase();
const getUserId = () => localStorage.getItem('userId');
const getUserName = () => localStorage.getItem('userName');

const authHeaders = () => ({
    'Authorization': 'Bearer ' + getToken()
});

const authJSON = () => ({
    'Authorization': 'Bearer ' + getToken(),
    'Content-Type': 'application/json'
});

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const STAR_PATH = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';
let starGradientIdSeed = 0;

function renderStarSvg(type = 'empty') {
    const baseAttrs = 'class="rating-star-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
    if (type === 'filled') {
        return `<svg ${baseAttrs}><path d="${STAR_PATH}" fill="currentColor"/></svg>`;
    }

    if (type === 'half') {
        const gradientId = `star-half-${++starGradientIdSeed}`;
        return `<svg ${baseAttrs}><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="0"><stop offset="50%" stop-color="currentColor"></stop><stop offset="50%" stop-color="transparent"></stop></linearGradient></defs><path d="${STAR_PATH}" fill="url(#${gradientId})" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`;
    }

    return `<svg ${baseAttrs}><path d="${STAR_PATH}" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"/></svg>`;
}

function renderRatingStars(rating, { max = 5, allowHalf = true, className = '' } = {}) {
    const value = Math.max(0, Math.min(max, Number(rating) || 0));
    let html = '';

    for (let index = 1; index <= max; index += 1) {
        let type = 'empty';
        if (value >= index) {
            type = 'filled';
        } else if (allowHalf && value >= index - 0.5) {
            type = 'half';
        }
        html += `<span class="rating-star-slot rating-star-slot--${type}">${renderStarSvg(type)}</span>`;
    }

    return `<span class="rating-stars ${className}" aria-label="Rating ${value.toFixed(1)} out of ${max}">${html}</span>`;
}

const EDIT_POPUP_IDS = ['edit-user-card', 'edit-restaurant-card', 'edit-item-card', 'vendor-edit-item-card'];

function syncEditPopupBodyLock() {
    const anyOpen = EDIT_POPUP_IDS.some((id) => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });

    document.body.classList.toggle('edit-popup-open', anyOpen);
}

function initEditPopupBehavior() {
    const onEsc = (e) => {
        if (e.key !== 'Escape') return;
        let closedAny = false;
        EDIT_POPUP_IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
                PandaPopup.close(el);
                closedAny = true;
            }
        });
        if (closedAny) syncEditPopupBodyLock();
    };
    document.addEventListener('keydown', onEsc);

    const onOutsideClick = (event) => {
        const openCards = EDIT_POPUP_IDS.map((id) => document.getElementById(id))
            .filter((el) => el && !el.classList.contains('hidden'));
        if (!openCards.length) return;
        if (openCards.some((el) => el.contains(event.target))) return;

        let closedAny = false;
        openCards.forEach((el) => {
            PandaPopup.close(el);
            closedAny = true;
        });
        if (closedAny) syncEditPopupBodyLock();
    };
    document.addEventListener('mousedown', onOutsideClick);

    EDIT_POPUP_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;

        const observer = new MutationObserver(syncEditPopupBodyLock);
        observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });

    syncEditPopupBodyLock();
}
// Performance: Lazy loading for images
function initLazyLoading() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) img.src = img.dataset.src, img.removeAttribute('data-src');
                    observer.unobserve(img);
                }
            });
        }, { rootMargin: '50px' });
        document.querySelectorAll('img[data-src]').forEach(img => imageObserver.observe(img));
    }
}

function showMsg(text, type = 'error') {
    // show toast message in bottom-left
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const icon = type === 'success'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    toast.innerHTML = icon + '<span>' + text + '</span>';
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4200);
}

function badgeCls(status) {
    return 'badge badge-' + (status || 'pending');
}

function formatStatus(s) {
    return (s || 'pending').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatPrice(amount) {
    const value = Number(amount || 0);
    const formatted = new Intl.NumberFormat('en-BD', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);

    return 'TK ' + formatted;
}

// navbar logic

function buildNav() {
    const nav = $('#dynamic-nav');
    const authBtn = $('#nav-auth-btn');
    if (!nav) return;

    const token = getToken();
    const role = getRole();

    let links = '';

    if (token) {
        links += '<li><a href="profile.html">Profile</a></li>';

        if (role === 'admin') {
            links += '<li><a href="admin.html">Dashboard</a></li>';
        }
        if (role === 'vendor') {
            links += '<li><a href="vendor.html">Vendor Hub</a></li>';
        }
        if (role === 'delivery') {
            links += '<li><a href="delivery.html">Delivery Hub</a></li>';
        }
        if (role === 'customer') {
            links += '<li><a href="my-orders.html">My Orders</a></li>';
        }

        nav.innerHTML = links;
        if (authBtn) {
            authBtn.textContent = 'Logout';
            authBtn.href = '#';
            if (!authBtn._logoutListenerAttached) {
                authBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Report logout to activity log before clearing auth
                    const tk = getToken();
                    if (tk) {
                        fetch(API + '/activity-log/logout', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' }
                        }).catch(() => {});
                    }
                    localStorage.clear();
                    window.location.href = 'login.html';
                });
                authBtn._logoutListenerAttached = true;
            }
        }
    } else {
        nav.innerHTML = '';
        if (authBtn) {
            authBtn.textContent = 'Login';
            authBtn.href = 'login.html';
        }
    }
}

// find which page is currently open

const page = (() => {
    const p = window.location.pathname.split('/').pop() || 'index';
    return p.replace(/\.html$/i, '').toLowerCase();
})();

// app start

document.addEventListener('DOMContentLoaded', () => {
    initLenis();
    buildNav();
    initScrollAnimations();
    initNavbarScroll();
    initParallax();
    initCardTilt();
    initHamburger();
    initFileUploadPlaceholders();
    initCustomDropdowns();
    initCommonButtonLogic();
    initEditPopupBehavior();
    initLazyLoading();

    const ownerInfoOverlay = $('#restaurant-owner-overlay');
    const ownerInfoClose = $('#restaurant-owner-close');
    if (ownerInfoOverlay) ownerInfoOverlay.addEventListener('click', closeRestaurantOwnerInfo);
    if (ownerInfoClose) ownerInfoClose.addEventListener('click', closeRestaurantOwnerInfo);

    if (page === 'index' || page === '') initHome();
    if (page === 'login') initLogin();
    if (page === 'profile') initProfile();
    if (page === 'my-orders') initMyOrders();
    if (page === 'delivery') initDelivery();
    if (page === 'admin') initAdmin();
    if (page === 'vendor') initVendor();

    // tab switch click handlers
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            btn.closest('.tabs').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const container = btn.closest('.container') || btn.closest('.page-with-sidebar');
            if (!container) return;
            container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            const panel = container.querySelector('#' + target);
            if (panel) panel.classList.add('active');
            // reload delivery map when map tab opens
            if (target === 'map-tab' && window._deliveryMapNeedsInit) initDeliveryMap();
        });
    });
});

// home page logic (index.html)

let cart = [];
let mapInstance = null;
let mapMarker = null;
let selectedLat = null;
let selectedLng = null;
let selectedAddressLabel = '';
let mapSearchDebounce = null;
let activeRestaurantIdForReviews = null;
let selectedReviewRating = 0;
let currentUserProfileImage = null;
let currentUserProfileRequested = false;
let currentUserDisplayName = null;
const menuItemById = new Map();

function escapeHtmlAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getNameInitials(name) {
    const safe = String(name || '').trim();
    if (!safe) return 'U';
    const parts = safe.split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'U';
}

function buildProfilePinIcon({ imageUrl, name }) {
    const hasImage = !!(imageUrl && String(imageUrl).trim());
    const safeName = escapeHtmlAttr(name || 'User');
    const fallback = `<span class="profile-pin-avatar-fallback">${getNameInitials(name)}</span>`;
    const imageMarkup = hasImage
        ? `<img src="${escapeHtmlAttr(imageUrl)}" alt="${safeName}" class="profile-pin-avatar-img" loading="lazy">`
        : fallback;

    const html = `
        <div class="profile-pin-wrap" title="${safeName}">
            <div class="profile-pin-avatar">${imageMarkup}</div>
            <div class="profile-pin-tail" aria-hidden="true"></div>
        </div>
    `;

    return L.divIcon({
        className: 'profile-pin-icon',
        html,
        iconSize: [74, 102],
        iconAnchor: [37, 102],
        popupAnchor: [0, -96]
    });
}

function createProfilePinMarker(map, lat, lng, { imageUrl, name, popupText, openPopup = false } = {}) {
    if (!map || typeof L === 'undefined') return null;
    const marker = L.marker([lat, lng], {
        icon: buildProfilePinIcon({ imageUrl, name })
    }).addTo(map);

    if (popupText) marker.bindPopup(popupText);
    if (openPopup && popupText) marker.openPopup();
    return marker;
}

async function getCurrentUserProfileImage() {
    if (!getToken()) return null;
    if (currentUserProfileImage) return currentUserProfileImage;
    if (currentUserProfileRequested) return null;

    currentUserProfileRequested = true;
    try {
        const res = await fetch(API + '/users/profile', { headers: authHeaders() });
        if (!res.ok) return null;
        const user = await res.json();
        currentUserDisplayName = (user && (user.full_name || user.username)) ? String(user.full_name || user.username).trim() : null;
        currentUserProfileImage = user && user.profile_image ? user.profile_image : null;
        return currentUserProfileImage;
    } catch (err) {
        console.error(err);
        return null;
    }
}

function initHome() {
    loadRestaurants();
    loadMenuItems();
    initRestaurantPopup();
    initItemDetailsPopup();
    initMapSearchHandlers();

    const menuList = $('#menu-list');
    if (menuList && menuList.dataset.itemDetailsBound !== '1') {
        menuList.addEventListener('click', (event) => {
            const card = event.target.closest('.menu-item-card');
            if (!card || event.target.closest('button')) return;

            const itemId = Number(card.dataset.itemId);
            if (!itemId) return;
            openItemDetailsById(itemId);
        });
        menuList.dataset.itemDetailsBound = '1';
    }

    // hero search functionality
    const searchInput = $('#hero-search-input');
    const searchBtn = $('#hero-search-btn');
    if (searchInput && searchBtn) {
        searchBtn.addEventListener('click', () => {
            const q = searchInput.value.trim().toLowerCase();
            if (q) filterMenuBySearch(q);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = searchInput.value.trim().toLowerCase();
                if (q) filterMenuBySearch(q);
            }
        });
    }

    // open/close cart + map popup
    const fab = $('#fab-cart');
    const popup = $('#cart-popup');
    const overlay = $('#cart-popup-overlay');
    const closeBtn = $('#popup-close');

    function openPopup() {
        PandaPopup.open(popup, overlay);
        // load map first time popup opens
        if (!mapInstance) setTimeout(initCheckoutMap, 100);
        else setTimeout(() => mapInstance.invalidateSize(), 150);
    }

    function closePopup() {
        PandaPopup.close(popup, overlay);
    }

    if (fab) fab.addEventListener('click', openPopup);
    if (overlay) overlay.addEventListener('click', closePopup);
    if (closeBtn) closeBtn.addEventListener('click', closePopup);

    const placeBtn = $('#place-order-btn');
    if (placeBtn) placeBtn.addEventListener('click', placeOrder);
}

// search filter (queries database directly via API)
async function filterMenuBySearch(query) {
    try {
        const res = await fetch(API + '/menu-items?search=' + encodeURIComponent(query));
        const data = await res.json();
        cacheMenuItems(data);
        const container = $('#menu-list');
        if (!data.length) {
            container.innerHTML = '<div class="empty-state"><p>No items match your search.</p></div>';
            return;
        }
        container.innerHTML = data.map(item => `
            <div class="card menu-item-card" data-item-id="${item.id}">
                <img class="card-img" src="${item.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E'}" alt="${item.name}" loading="lazy" decoding="async">
                <div class="card-body">
                    <h3>${item.name}</h3>
                    ${item.description ? '<p class="card-desc">' + item.description + '</p>' : ''}
                    <p class="price">${formatPrice(item.price)}</p>
                    <div class="item-card-actions mt-1">
                        <button class="btn btn-primary btn-sm" onclick="addToCart(${item.id}, '${item.name.replace(/'/g, "\\'") }', ${item.price})">Add to Cart</button>
                    </div>
                </div>
            </div>
        `).join('');
        // scroll to menu section
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        console.error(err);
    }
}

async function loadRestaurants() {
    try {
        const [restaurantsRes, reviewsRes] = await Promise.all([
            fetch(API + '/restaurants'),
            fetch(API + '/reviews')
        ]);

        if (!restaurantsRes.ok) return showMsg('Failed to load restaurants.');
        const data = await restaurantsRes.json();
        const allReviews = reviewsRes.ok ? await reviewsRes.json() : [];

        const reviewStatsByRestaurant = (Array.isArray(allReviews) ? allReviews : []).reduce((acc, review) => {
            const restaurantId = Number(review.restaurant_id);
            const rating = Number(review.rating);
            if (!restaurantId || Number.isNaN(rating)) return acc;

            if (!acc[restaurantId]) acc[restaurantId] = { sum: 0, count: 0 };
            acc[restaurantId].sum += rating;
            acc[restaurantId].count += 1;
            return acc;
        }, {});

        const container = $('#restaurant-list');
        if (!data.length) {
            container.innerHTML = '<div class="empty-state"><p>No restaurants available.</p></div>';
            return;
        }

        const renderRatingSummary = (restaurantId) => {
            const stats = reviewStatsByRestaurant[Number(restaurantId)];
            if (!stats || !stats.count) {
                return `
                    <div class="restaurant-rating-summary no-reviews">
                        ${renderRatingStars(0, { allowHalf: false, className: 'restaurant-rating-stars' })}
                        <span class="restaurant-rating-text">No reviews yet</span>
                    </div>
                `;
            }

            const avg = stats.sum / stats.count;

            return `
                <div class="restaurant-rating-summary" title="Average rating">
                    ${renderRatingStars(Math.round(avg * 2) / 2, { className: 'restaurant-rating-stars' })}
                    <span class="restaurant-rating-text">${avg.toFixed(1)} (${stats.count})</span>
                </div>
            `;
        };

        container.innerHTML = data.map(r => `
            <div class="card restaurant-click-card"
                 data-restaurant-id="${r.id}"
                 data-restaurant-name="${escapeHtmlAttr(r.name)}"
                 data-owner-username="${escapeHtmlAttr(r.owner_username || '')}"
                 data-owner-name="${escapeHtmlAttr(r.owner_name || '')}"
                 data-owner-role="${escapeHtmlAttr(r.owner_role || '')}"
                 data-owner-email="${escapeHtmlAttr(r.owner_email || '')}"
                 data-owner-phone="${escapeHtmlAttr(r.owner_phone || '')}"
                 style="cursor:pointer;">
                <img class="card-img" src="${r.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E'}" alt="${r.name}" loading="lazy" decoding="async">
                <div class="card-body">
                    <div class="restaurant-card-head">
                        <h3>${r.name}</h3>
                        <button class="restaurant-info-btn" type="button" aria-label="Restaurant owner info" title="Restaurant owner info">i</button>
                    </div>
                    <p>${r.description || 'Click to view menu'}</p>
                    ${renderRatingSummary(r.id)}
                </div>
            </div>
        `).join('');

        refreshDynamicAnimations(container);


        if (container && container.dataset.restaurantClickBound !== '1') {
            container.addEventListener('click', (event) => {
                const card = event.target.closest('.restaurant-click-card');
                if (!card || !container.contains(card)) return;

                const infoBtn = event.target.closest('.restaurant-info-btn');
                if (infoBtn) {
                    event.preventDefault();
                    openRestaurantOwnerInfo(card);
                    return;
                }

                const id = Number(card.dataset.restaurantId);
                const name = card.dataset.restaurantName || '';
                if (!id) return;
                filterByRestaurant(id, name);
            });
            container.dataset.restaurantClickBound = '1';
        }
    } catch (err) {
        console.error(err);
    }
}

function openRestaurantOwnerInfo(cardEl) {
    const overlay = $('#restaurant-owner-overlay');
    const popup = $('#restaurant-owner-popup');
    if (!overlay || !popup || !cardEl) return;

    const ownerRole = String(cardEl.dataset.ownerRole || '').trim().toLowerCase();
    const roleLabel = ownerRole ? formatStatus(ownerRole) : 'Unassigned';

    const setText = (selector, value) => {
        const el = $(selector);
        if (el) el.textContent = value || '-';
    };

    setText('#owner-info-restaurant', cardEl.dataset.restaurantName || '-');
    setText('#owner-info-role', roleLabel);
    setText('#owner-info-username', cardEl.dataset.ownerUsername || '-');
    setText('#owner-info-name', cardEl.dataset.ownerName || '-');
    setText('#owner-info-email', cardEl.dataset.ownerEmail || '-');
    setText('#owner-info-phone', cardEl.dataset.ownerPhone || '-');

    PandaPopup.open(popup, overlay);
}

function closeRestaurantOwnerInfo() {
    const overlay = $('#restaurant-owner-overlay');
    const popup = $('#restaurant-owner-popup');
    PandaPopup.close(popup, overlay);
}

async function loadMenuItems(restaurantId) {
    try {
        let url = API + '/menu-items';
        if (restaurantId) url += '?restaurant_id=' + restaurantId;
        const res = await fetch(url);
        if (!res.ok) return showMsg('Failed to load menu items.');
        const data = await res.json();
        cacheMenuItems(data);
        const container = $('#menu-list');
        if (!data.length) {
            container.innerHTML = '<div class="empty-state"><p>No menu items found.</p></div>';
            return;
        }
        container.innerHTML = data.map(item => `
            <div class="card menu-item-card" data-item-id="${item.id}">
                <img class="card-img" src="${item.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E'}" alt="${item.name}" loading="lazy" decoding="async">
                <div class="card-body">
                    <h3>${item.name}</h3>
                    ${item.description ? '<p class="card-desc">' + item.description + '</p>' : ''}
                    <p class="price">${formatPrice(item.price)}</p>
                    <div class="item-card-actions mt-1">
                        <button class="btn btn-primary btn-sm" onclick="addToCart(${item.id}, '${item.name.replace(/'/g, "\\'")}', ${item.price})">Add to Cart</button>
                    </div>
                </div>
            </div>
        `).join('');

        refreshDynamicAnimations(container);

    } catch (err) {
        console.error(err);
    }
}

// keep this global — opens restaurant popup instead of replacing menu list
window.filterByRestaurant = (id, name) => openRestaurantPopup(id, name);

window.addToCart = (id, name, price) => {
    const existing = cart.find(c => c.menu_item_id === id);
    if (existing) { existing.quantity++; }
    else { cart.push({ menu_item_id: id, name, price, quantity: 1 }); }
    renderCart();
};

window.removeFromCart = (id) => {
    cart = cart.filter(c => c.menu_item_id !== id);
    renderCart();
};

function renderCart() {
    const container = $('#cart-items');
    const totalRow = $('#cart-total-row');
    const totalEl = $('#cart-total');
    const placeBtn = $('#place-order-btn');
    const fabBadge = $('#fab-badge');

    // update cart badge count
    const count = cart.reduce((s, c) => s + c.quantity, 0);
    if (fabBadge) {
        fabBadge.textContent = count;
        if (count > 0) fabBadge.classList.remove('hidden');
        else fabBadge.classList.add('hidden');
    }

    if (!cart.length) {
        container.innerHTML = '<p class="text-muted" style="font-size:.9rem;">Your cart is empty.</p>';
        totalRow.classList.add('hidden');
        placeBtn.classList.add('hidden');
        return;
    }

    container.innerHTML = cart.map(c => `
        <div class="cart-item">
            <span>${c.name} x${c.quantity}</span>
            <span>
                ${formatPrice(c.price * c.quantity)}
                <button class="btn btn-danger btn-sm" style="padding:.15rem .5rem;margin-left:.4rem;font-size:.75rem;" onclick="removeFromCart(${c.menu_item_id})">X</button>
            </span>
        </div>
    `).join('');

    const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
    totalEl.textContent = formatPrice(total);
    totalRow.classList.remove('hidden');
    placeBtn.classList.remove('hidden');
}

// checkout map (user drops pin)

function initMapSearchHandlers() {
    const input = $('#map-search-input');
    const btn = $('#map-search-btn');
    const resultBox = $('#map-search-results');
    if (!input || !btn || !resultBox) return;

    const runSearch = () => {
        const query = input.value.trim();
        if (!query) {
            resultBox.classList.add('hidden');
            resultBox.innerHTML = '';
            return;
        }
        searchDeliveryPlace(query);
    };

    btn.addEventListener('click', runSearch);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runSearch();
        }
    });

    input.addEventListener('input', () => {
        const query = input.value.trim();
        if (mapSearchDebounce) clearTimeout(mapSearchDebounce);
        mapSearchDebounce = setTimeout(() => {
            if (query.length < 3) {
                resultBox.classList.add('hidden');
                resultBox.innerHTML = '';
                return;
            }
            searchDeliveryPlace(query);
        }, 260);
    });
}

async function searchDeliveryPlace(query) {
    const resultBox = $('#map-search-results');
    if (!resultBox) return;

    resultBox.classList.remove('hidden');
    resultBox.innerHTML = '<button type="button" class="map-search-result" disabled>Searching...</button>';

    try {
        const url = `${NOMINATIM_SEARCH_URL}?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
            headers: {
                Accept: 'application/json'
            }
        });

        if (!res.ok) throw new Error('Search failed');
        const places = await res.json();

        if (!Array.isArray(places) || !places.length) {
            resultBox.innerHTML = '<button type="button" class="map-search-result" disabled>No locations found</button>';
            return;
        }

        resultBox.innerHTML = '';

        places.forEach((place) => {
            const lat = Number(place.lat);
            const lon = Number(place.lon);
            if (Number.isNaN(lat) || Number.isNaN(lon)) return;

            const label = place.display_name || 'Selected location';
            const itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = 'map-search-result';
            itemBtn.textContent = label;
            itemBtn.addEventListener('click', () => {
                setCheckoutLocation(lat, lon, label);
                resultBox.classList.add('hidden');
            });

            resultBox.appendChild(itemBtn);
        });

        if (!resultBox.children.length) {
            resultBox.innerHTML = '<button type="button" class="map-search-result" disabled>No locations found</button>';
        }
    } catch (err) {
        console.error(err);
        resultBox.innerHTML = '<button type="button" class="map-search-result" disabled>Search unavailable. Drop pin manually.</button>';
    }
}

function setCheckoutLocation(lat, lng, label = 'Delivery here') {
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    selectedLat = lat;
    selectedLng = lng;
    selectedAddressLabel = label;

    if ($('#lat')) $('#lat').value = selectedLat;
    if ($('#lng')) $('#lng').value = selectedLng;

    if (!mapInstance) return;

    if (mapMarker) mapInstance.removeLayer(mapMarker);
    mapMarker = createProfilePinMarker(mapInstance, selectedLat, selectedLng, {
        name: currentUserDisplayName || getUserName() || 'You',
        popupText: label,
        openPopup: true
    });

    const markerRef = mapMarker;
    getCurrentUserProfileImage().then((imageUrl) => {
        if (!imageUrl || !markerRef || markerRef !== mapMarker) return;
        markerRef.setIcon(buildProfilePinIcon({ imageUrl, name: currentUserDisplayName || getUserName() || 'You' }));
    });

    mapInstance.setView([selectedLat, selectedLng], Math.max(mapInstance.getZoom(), 15));
}

function initCheckoutMap() {
    const mapEl = document.getElementById('map');
    if (!mapEl || typeof L === 'undefined') return;

    mapInstance = L.map('map').setView([23.8103, 90.4125], 13); // default map center = Dhaka
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(mapInstance);

    mapInstance.on('click', (e) => {
        setCheckoutLocation(e.latlng.lat, e.latlng.lng, 'Delivery pin');
    });
}

// place order

async function placeOrder() {
    if (!getToken()) { showMsg('Please login first.'); return window.location.href = 'login.html'; }
    if (!cart.length) return showMsg('Cart is empty.');
    if (!selectedLat || !selectedLng) return showMsg('Please drop a pin on the map for delivery location.');

    try {
        const body = {
            items: cart.map(c => ({ menu_item_id: c.menu_item_id, quantity: c.quantity })),
            delivery_address: selectedLat.toFixed(6) + ', ' + selectedLng.toFixed(6),
            payment_method: 'cash'
        };

        const res = await fetch(API + '/orders', {
            method: 'POST',
            headers: authJSON(),
            body: JSON.stringify(body)
        });

        const data = await res.json();
        if (!res.ok) return showMsg(data.error);

        showMsg('Order #' + data.orderId + ' placed!', 'success');
        cart = [];
        renderCart();
    } catch (err) {
        console.error(err);
        showMsg('Failed to place order.');
    }
}


// ============================================================
// RESTAURANT MENU POPUP + CAROUSEL
// ============================================================

function initRestaurantPopup() {
    const popup = $('#rest-popup');
    const overlay = $('#rest-popup-overlay');
    const closeBtn = $('#rest-popup-close');
    const prevBtn = $('#carousel-prev');
    const nextBtn = $('#carousel-next');

    if (!popup) return;

    function closePopup() {
        PandaPopup.close(popup, overlay);
    }

    overlay.addEventListener('click', closePopup);
    closeBtn.addEventListener('click', closePopup);

    // carousel arrow buttons
    const carousel = $('#rest-carousel');
    if (prevBtn) prevBtn.addEventListener('click', () => {
        const cardW = carousel.querySelector('.carousel-card')?.offsetWidth || 280;
        carousel.scrollBy({ left: -(cardW + 16), behavior: 'smooth' });
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
        const cardW = carousel.querySelector('.carousel-card')?.offsetWidth || 280;
        carousel.scrollBy({ left: cardW + 16, behavior: 'smooth' });
    });

    
    // Mouse drag scrolling
    let isDown = false;
    let startX;
    let scrollLeft;
    let hasDragged = false;

    carousel.addEventListener('mousedown', (e) => {
        isDown = true;
        hasDragged = false;
        carousel.classList.add('is-dragging');
        startX = e.pageX - carousel.offsetLeft;
        scrollLeft = carousel.scrollLeft;
    });

    carousel.addEventListener('mouseleave', () => {
        isDown = false;
        carousel.classList.remove('is-dragging');
    });

    carousel.addEventListener('mouseup', () => {
        isDown = false;
        carousel.classList.remove('is-dragging');
    });

    carousel.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - carousel.offsetLeft;
        const walk = (x - startX) * 1.5; // Drag speed multiplier
        if (Math.abs(walk) > 5) hasDragged = true;
        carousel.scrollLeft = scrollLeft - walk;
    });

    // intercept click
    carousel.addEventListener('click', (e) => {
        if (hasDragged) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    carousel.addEventListener('click', (event) => {
        const addBtn = event.target.closest('.carousel-add-btn');
        if (addBtn) return;

        const card = event.target.closest('.carousel-card');
        if (!card) return;

        const itemId = Number(card.dataset.itemId);
        if (!itemId) return;
        openItemDetailsById(itemId);
    });

    // Update dots on scroll

    carousel.addEventListener('scroll', () => updateCarouselDots());
}

async function openRestaurantPopup(restaurantId, restaurantName) {
    const popup = $('#rest-popup');
    const overlay = $('#rest-popup-overlay');
    const nameEl = $('#rest-popup-name');
    const carousel = $('#rest-carousel');
    const dotsEl = $('#carousel-dots');
    const submitReviewBtn = $('#submit-review-btn');

    nameEl.textContent = restaurantName || 'Restaurant Menu';
    carousel.innerHTML = '<p style="padding:1rem;color:var(--text-light)">Loading...</p>';
    dotsEl.innerHTML = '';

    activeRestaurantIdForReviews = restaurantId;
    selectedReviewRating = 0;
    setupReviewStarPicker();
    refreshReviewWriteVisibility();
    loadRestaurantReviews(restaurantId);

    if (submitReviewBtn && submitReviewBtn.dataset.bound !== '1') {
        submitReviewBtn.addEventListener('click', submitRestaurantReview);
        submitReviewBtn.dataset.bound = '1';
    }

    PandaPopup.open(popup, overlay);

    try {
        const res = await fetch(API + '/menu-items?restaurant_id=' + restaurantId);
        const items = await res.json();
        cacheMenuItems(items);

        if (!items.length) {
            carousel.innerHTML = '<p style="padding:1.5rem;color:var(--text-light);text-align:center">No items available yet.</p>';
            return;
        }

        carousel.innerHTML = items.map(item => `
            <div class="carousel-card" data-item-id="${item.id}">
                <img src="${item.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E'}" alt="${item.name}" loading="lazy" decoding="async">
                <div class="carousel-card-body">
                    <h4>${item.name}</h4>
                    ${item.description ? '<p class="card-desc">' + item.description + '</p>' : ''}
                    <div class="carousel-card-footer">
                        <span class="price">${formatPrice(item.price)}</span>
                        <div class="item-card-actions">
                            <button class="btn btn-primary btn-sm carousel-add-btn" onclick="addToCart(${item.id}, '${item.name.replace(/'/g, "\\'")}', ${item.price})">Add to Cart</button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

        // create dots
        dotsEl.innerHTML = items.map((_, i) =>
            `<button class="dot${i === 0 ? ' active' : ''}" onclick="scrollCarouselTo(${i})"></button>`
        ).join('');

    } catch (err) {
        console.error(err);
        carousel.innerHTML = '<p style="padding:1rem;color:var(--text-light)">Failed to load menu.</p>';
    }
}

function cacheMenuItems(items) {
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
        const id = Number(item && item.id);
        if (!id) return;
        menuItemById.set(id, item);
    });
}

function initItemDetailsPopup() {
    const overlay = $('#item-details-overlay');
    const popup = $('#item-details-popup');
    const closeBtn = $('#item-details-close');
    if (!overlay || !popup || !closeBtn) return;

    const closePopup = () => {
        PandaPopup.close(popup, overlay);
    };

    overlay.addEventListener('click', closePopup);
    closeBtn.addEventListener('click', closePopup);
}

function openItemDetailsById(itemId) {
    const item = menuItemById.get(Number(itemId));
    if (!item) return;

    const overlay = $('#item-details-overlay');
    const popup = $('#item-details-popup');
    const imageEl = $('#item-details-image');
    const nameEl = $('#item-details-name');
    const priceEl = $('#item-details-price');
    const categoryEl = $('#item-details-category');
    const restaurantEl = $('#item-details-restaurant');
    const descriptionEl = $('#item-details-description');
    const addBtn = $('#item-details-add-btn');
    if (!overlay || !popup || !imageEl || !nameEl || !priceEl || !categoryEl || !restaurantEl || !descriptionEl || !addBtn) return;

    const fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E';

    imageEl.src = item.image || fallbackImage;
    imageEl.alt = item.name || 'Menu item';
    nameEl.textContent = item.name || 'Unnamed item';
    priceEl.textContent = formatPrice(item.price);
    restaurantEl.textContent = item.restaurant_name || 'Unknown restaurant';
    descriptionEl.textContent = item.description || 'No description provided.';

    if (item.category_name) {
        categoryEl.textContent = item.category_name;
        categoryEl.classList.remove('hidden');
    } else {
        categoryEl.textContent = '';
        categoryEl.classList.add('hidden');
    }

    addBtn.onclick = () => {
        window.addToCart(item.id, item.name, item.price);
        showMsg(`${item.name} added to cart.`, 'success');
    };

    PandaPopup.open(popup, overlay);
}

function updateCarouselDots() {
    const carousel = $('#rest-carousel');
    const dots = $('#carousel-dots .dot');
    if (!dots.length) return;
    const cards = carousel.querySelectorAll('.carousel-card');
    if (!cards.length) return;

    const scrollLeft = carousel.scrollLeft;
    const cardW = cards[0].offsetWidth + 16; // gap
    const activeIndex = Math.round(scrollLeft / cardW);

    dots.forEach((d, i) => {
        d.classList.toggle('active', i === activeIndex);
    });
}

window.scrollCarouselTo = (index) => {
    const carousel = $('#rest-carousel');
    const cards = carousel.querySelectorAll('.carousel-card');
    if (!cards[index]) return;
    const cardW = cards[0].offsetWidth + 16;
    carousel.scrollTo({ left: cardW * index, behavior: 'smooth' });
};

function setupReviewStarPicker() {
    const stars = Array.from($$('#review-stars .review-star'));
    if (!stars.length) return;

    stars.forEach((star) => {
        if (!star.innerHTML.trim()) {
            star.innerHTML = renderStarSvg('filled');
        }
    });

    const paint = (rating) => {
        stars.forEach((star) => {
            const value = Number(star.dataset.rating);
            star.classList.toggle('is-active', value <= rating);
            star.setAttribute('aria-pressed', String(value <= rating));
        });
    };

    stars.forEach((star) => {
        if (star.dataset.bound === '1') return;
        star.addEventListener('mouseenter', () => paint(Number(star.dataset.rating)));
        star.addEventListener('mouseleave', () => paint(selectedReviewRating));
        star.addEventListener('click', () => {
            selectedReviewRating = Number(star.dataset.rating);
            paint(selectedReviewRating);
        });
        star.dataset.bound = '1';
    });

    paint(selectedReviewRating);
}

function renderReviewList(container, reviews, opts = {}) {
    if (!container) return;
    const showReplyEditor = !!opts.showReplyEditor;
    const currentRole = getRole();
    const isAdmin = currentRole === 'admin';
    const currentUser = getToken()
        ? String(getUserName() || localStorage.getItem('username') || '').trim().toLowerCase()
        : '';

    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    if (!reviews.length) {
        container.innerHTML = '<p class="text-muted" style="font-size:.88rem;">No reviews yet.</p>';
        return;
    }

    container.innerHTML = reviews.map((review) => {
        const score = Number(review.rating) || 0;
        const stars = renderRatingStars(score, { allowHalf: false, className: 'review-stars-label' });
        const reviewText = review.comment ? escapeHtml(review.comment) : 'No written comment.';
        const vendorDisplay = String(review.vendor_full_name || 'Vendor').trim();
        const vendorReply = review.vendor_reply
            ? `<div class="review-vendor-reply"><strong>${escapeHtml(vendorDisplay)} <span class="review-vendor-tag">Vendor</span>:</strong><p>${escapeHtml(review.vendor_reply)}</p></div>`
            : '';

        const reviewerRaw = String(review.user_username || review.username || '').trim();
        const reviewerDisplay = String(review.user_full_name || reviewerRaw || 'Customer').trim();
        const safeReviewer = escapeHtml(reviewerDisplay || 'Customer');
        const isOwner = !!currentUser && currentUser === reviewerRaw.toLowerCase();

        const profileImgUrl = review.user_profile_image ? String(review.user_profile_image).trim() : '';
        const initials = escapeHtml(
            reviewerDisplay
                ? reviewerDisplay.split(/\s+/).filter((p) => p).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('')
                : 'U'
        );
        const avatarInner = profileImgUrl
            ? `<img src="${escapeHtml(profileImgUrl)}" alt="${safeReviewer}" class="review-avatar-img" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'review-avatar-initials\\'>${initials}</span>'">`
            : `<span class="review-avatar-initials">${initials}</span>`;
        const avatar = `<div class="review-avatar" aria-hidden="true">${avatarInner}</div>`;

        const ownerActions = isOwner && !showReplyEditor
            ? `<button class="btn btn-sm btn-outline-primary review-edit-btn" data-review-id="${review.id}" data-rating="${review.rating}" data-comment="${escapeHtml(review.comment || '')}">Edit</button>
               <button class="btn btn-sm btn-outline-danger review-delete-btn" data-review-id="${review.id}">Delete</button>`
            : '';

        const adminActions = isAdmin && !showReplyEditor
            ? `<button class="btn btn-sm btn-outline-danger review-delete-btn" data-review-id="${review.id}">Delete Review</button>
               ${review.vendor_reply ? `<button class="btn btn-sm btn-outline-danger review-reply-delete-btn" data-review-id="${review.id}">Delete Reply</button>` : ''}`
            : '';

        const actionButtons = (ownerActions || adminActions)
            ? `<div class="review-actions gap-row" style="gap:.5rem;margin-top:0.5rem;">${ownerActions}${adminActions}</div>`
            : '';

        const replyEditor = showReplyEditor
            ? `<div class="review-reply-editor">
                    <textarea class="form-control vendor-reply-input" rows="2" placeholder="Write a reply to this review">${escapeHtml(review.vendor_reply || '')}</textarea>
                    <div class="gap-row mt-1" style="justify-content:flex-end;">
                        <button class="btn btn-primary btn-sm vendor-reply-btn" data-review-id="${review.id}">Save Reply</button>
                        <button class="btn btn-danger btn-sm vendor-reply-delete-btn" data-review-id="${review.id}" ${review.vendor_reply ? '' : 'disabled'}>Delete Reply</button>
                    </div>
               </div>`
            : '';

        return `<div class="review-item" data-review-id="${review.id}">
            <div class="review-item-head">
                <div class="review-author-info">
                    ${avatar}
                    <strong>${safeReviewer}</strong>
                </div>
                ${stars}
            </div>
            <p class="review-item-text">${reviewText}</p>
            ${vendorReply}
            ${actionButtons}
            ${replyEditor}
        </div>`;
    }).join('');

    // Attach event listeners
    if (!showReplyEditor) {
        container.querySelectorAll('.review-edit-btn').forEach((btn) => {
            btn.addEventListener('click', () => openReviewEditModal(btn));
        });
        container.querySelectorAll('.review-delete-btn').forEach((btn) => {
            btn.addEventListener('click', () => deleteReview(btn.dataset.reviewId));
        });
        container.querySelectorAll('.review-reply-delete-btn').forEach((btn) => {
            btn.addEventListener('click', () => deleteReviewReplyOnly(btn.dataset.reviewId));
        });
    }
}

async function loadRestaurantReviews(restaurantId) {
    const listEl = $('#rest-review-list');
    const avgEl = $('#rest-review-avg');
    if (!listEl) return;

    listEl.innerHTML = '<p class="text-muted" style="font-size:.88rem;">Loading reviews...</p>';
    if (avgEl) {
        avgEl.classList.add('hidden');
        avgEl.textContent = '';
    }

    try {
        const res = await fetch(API + '/reviews?restaurant_id=' + encodeURIComponent(restaurantId));
        const reviews = res.ok ? await res.json() : [];

        renderReviewList(listEl, reviews);

        if (avgEl && reviews.length) {
            const total = reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0);
            const avg = total / reviews.length;
            avgEl.classList.remove('hidden');
            avgEl.textContent = `${avg.toFixed(1)} / 5 (${reviews.length})`;
        }
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<p class="text-muted" style="font-size:.88rem;">Failed to load reviews.</p>';
    }
}

function refreshReviewWriteVisibility() {
    const wrap = $('#review-form-wrap');
    if (!wrap) return;
    const role = getRole();
    const isCustomer = !!getToken() && role === 'customer';
    wrap.classList.toggle('hidden', !isCustomer);
}

async function submitRestaurantReview() {
    if (!activeRestaurantIdForReviews) return;
    if (!getToken() || getRole() !== 'customer') {
        showMsg('Only logged-in customers can submit reviews.');
        return;
    }
    if (!selectedReviewRating) {
        showMsg('Please select a rating from 1 to 5.');
        return;
    }

    const commentEl = $('#review-comment');
    const payload = {
        restaurant_id: activeRestaurantIdForReviews,
        rating: selectedReviewRating,
        comment: commentEl ? commentEl.value.trim() : ''
    };

    try {
        const res = await fetch(API + '/reviews', {
            method: 'POST',
            headers: authJSON(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error || 'Failed to submit review.');

        selectedReviewRating = 0;
        setupReviewStarPicker();
        if (commentEl) commentEl.value = '';
        showMsg('Thanks! Your review has been posted.', 'success');
        loadRestaurantReviews(activeRestaurantIdForReviews);
    } catch (err) {
        console.error(err);
        showMsg('Failed to submit review.');
    }
}

async function openReviewEditModal(btn) {
    const reviewId = btn.dataset.reviewId;
    const currentRating = Number(btn.dataset.rating);
    const currentComment = btn.dataset.comment;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:90%;max-width:500px;">
            <div class="modal-header">
                <h5>Edit Your Review</h5>
                <button type="button" class="close-modal" style="background:none;border:none;font-size:1.5rem;cursor:pointer;">&times;</button>
            </div>
            <div class="modal-body" style="padding:1rem;">
                <div style="margin-bottom:1rem;">
                    <label>Rating:</label>
                    <div class="review-stars edit-modal-stars" style="font-size:2rem;cursor:pointer;">
                        ${['1','2','3','4','5'].map(n => `<button type="button" class="edit-star-btn${Number(n) <= currentRating ? ' is-active' : ''}" data-rating="${n}" aria-label="Rate ${n} star${Number(n) === 1 ? '' : 's'}">${renderStarSvg('filled')}</button>`).join('')}
                    </div>
                </div>
                <div>
                    <label>Comment:</label>
                    <textarea class="form-control edit-review-comment" rows="3" style="width:100%;padding:0.5rem;">${escapeHtml(currentComment)}</textarea>
                </div>
            </div>
            <div class="modal-footer" style="padding:1rem;display:flex;gap:0.5rem;justify-content:flex-end;border-top:1px solid #ccc;">
                <button class="btn btn-secondary cancel-edit-btn">Cancel</button>
                <button class="btn btn-primary save-edit-btn" data-review-id="${reviewId}">Save Changes</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    let editRating = currentRating;

    modal.querySelectorAll('.edit-star-btn').forEach((star) => {
        star.addEventListener('click', () => {
            editRating = Number(star.dataset.rating);
            modal.querySelectorAll('.edit-star-btn').forEach((s, idx) => {
                s.classList.toggle('is-active', (idx + 1) <= editRating);
            });
        });
        star.addEventListener('mouseover', () => {
            const hovRating = Number(star.dataset.rating);
            modal.querySelectorAll('.edit-star-btn').forEach((s, idx) => {
                s.classList.toggle('is-active', (idx + 1) <= hovRating);
            });
        });
    });

    modal.addEventListener('mouseleave', () => {
        modal.querySelectorAll('.edit-star-btn').forEach((s, idx) => {
            s.classList.toggle('is-active', (idx + 1) <= editRating);
        });
    });

    modal.querySelector('.cancel-edit-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());

    modal.querySelector('.save-edit-btn').addEventListener('click', async () => {
        const commentEl = modal.querySelector('.edit-review-comment');
        const newComment = commentEl.value.trim();

        const payload = {
            rating: editRating,
            comment: newComment
        };

        try {
            const res = await fetch(API + '/reviews/' + reviewId, {
                method: 'PUT',
                headers: authJSON(),
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
                showMsg(data.error || 'Failed to update review.');
                return;
            }

            showMsg('Review updated!', 'success');
            modal.remove();
            loadRestaurantReviews(activeRestaurantIdForReviews);
        } catch (err) {
            console.error(err);
            showMsg('Failed to update review.');
        }
    });
}

async function deleteReview(reviewId) {
    if (!confirm('Are you sure you want to delete this review? This cannot be undone.')) return;

    try {
        const res = await fetch(API + '/reviews/' + reviewId, {
            method: 'DELETE',
            headers: authJSON()
        });
        const data = await res.json();
        if (!res.ok) {
            showMsg(data.error || 'Failed to delete review.');
            return;
        }

        showMsg('Review deleted.', 'success');
        loadRestaurantReviews(activeRestaurantIdForReviews);
    } catch (err) {
        console.error(err);
        showMsg('Failed to delete review.');
    }
}

async function deleteReviewReplyOnly(reviewId) {
    if (!confirm('Delete only the vendor reply from this review?')) return;

    try {
        const res = await fetch(API + '/reviews/' + reviewId + '/reply', {
            method: 'DELETE',
            headers: authJSON()
        });
        const data = await res.json();
        if (!res.ok) {
            showMsg(data.error || 'Failed to delete reply.');
            return;
        }

        showMsg('Reply deleted.', 'success');
        loadRestaurantReviews(activeRestaurantIdForReviews);
    } catch (err) {
        console.error(err);
        showMsg('Failed to delete reply.');
    }
}

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

async function vendorLoadReviews(restaurantId) {
    const listEl = $('#vendor-reviews-list');
    if (!listEl) return;

    listEl.innerHTML = '<p class="text-muted">Loading reviews...</p>';
    try {
        const res = await fetch(API + '/reviews?restaurant_id=' + encodeURIComponent(restaurantId));
        const reviews = res.ok ? await res.json() : [];
        renderReviewList(listEl, reviews, { showReplyEditor: true });

        listEl.querySelectorAll('.vendor-reply-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const reviewId = btn.dataset.reviewId;
                const card = btn.closest('.review-item');
                const input = card ? card.querySelector('.vendor-reply-input') : null;
                const reply = input ? input.value.trim() : '';
                if (!reply) {
                    showMsg('Please write a reply before saving.');
                    return;
                }

                try {
                    const saveRes = await fetch(API + '/reviews/' + reviewId + '/reply', {
                        method: 'PUT',
                        headers: authJSON(),
                        body: JSON.stringify({ reply })
                    });
                    const saveData = await saveRes.json();
                    if (!saveRes.ok) return showMsg(saveData.error || 'Reply failed.');
                    showMsg('Reply posted.', 'success');
                    vendorLoadReviews(restaurantId);
                } catch (err) {
                    console.error(err);
                    showMsg('Reply failed.');
                }
            });
        });

        listEl.querySelectorAll('.vendor-reply-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const reviewId = btn.dataset.reviewId;
                if (!reviewId) return;
                if (!confirm('Delete your reply from this review?')) return;

                try {
                    const delRes = await fetch(API + '/reviews/' + reviewId + '/reply', {
                        method: 'DELETE',
                        headers: authJSON()
                    });
                    const delData = await delRes.json();
                    if (!delRes.ok) return showMsg(delData.error || 'Failed to delete reply.');
                    showMsg('Reply deleted.', 'success');
                    vendorLoadReviews(restaurantId);
                } catch (err) {
                    console.error(err);
                    showMsg('Failed to delete reply.');
                }
            });
        });
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<p class="text-muted">Failed to load reviews.</p>';
    }
}

// login page logic (login.html)

function initLogin() {
    // Auth tab switching (login/signup tabs)
    const tabLogin = $('#tab-login');
    const tabSignup = $('#tab-signup');
    const tabLogin2 = $('#tab-login-2');
    const tabSignup2 = $('#tab-signup-2');
    const showLog = $('#show-login');

    function showLoginCard() {
        $('#login-card').classList.remove('hidden');
        $('#register-card').classList.add('hidden');
    }
    function showRegisterCard() {
        $('#login-card').classList.add('hidden');
        $('#register-card').classList.remove('hidden');
    }

    if (tabLogin) tabLogin.addEventListener('click', showLoginCard);
    if (tabSignup) tabSignup.addEventListener('click', showRegisterCard);
    if (tabLogin2) tabLogin2.addEventListener('click', showLoginCard);
    if (tabSignup2) tabSignup2.addEventListener('click', showRegisterCard);
    if (showLog) showLog.addEventListener('click', e => { e.preventDefault(); showLoginCard(); });

    // Show/hide password toggles for auth forms.
    document.querySelectorAll('.password-toggle[data-password-target]').forEach((btn) => {
        const inputId = btn.getAttribute('data-password-target');
        const input = inputId ? document.getElementById(inputId) : null;
        if (!input) return;

        const syncToggleState = () => {
            const revealed = input.type === 'text';
            btn.classList.toggle('is-revealed', revealed);
            btn.setAttribute('aria-pressed', String(revealed));
            btn.setAttribute('aria-label', revealed ? 'Hide password' : 'Show password');
        };

        btn.addEventListener('click', () => {
            input.type = input.type === 'password' ? 'text' : 'password';
            syncToggleState();
            input.focus({ preventScroll: true });

            const caretPos = input.value.length;
            if (typeof input.setSelectionRange === 'function') {
                input.setSelectionRange(caretPos, caretPos);
            }
        });

        syncToggleState();
    });

    const loginForm = $('#login-form');
    if (loginForm) loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const identifier = $('#login-identifier').value.trim();
            const res = await fetch(API + '/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    identifier,
                    password: $('#login-password').value
                })
            });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);

            localStorage.setItem('token', data.token);
            localStorage.setItem('role', data.role);
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('userName', data.username);

            showMsg('Welcome, ' + data.username + '!', 'success');

            setTimeout(() => {
                if (data.role === 'admin') window.location.href = 'admin.html';
                else if (data.role === 'delivery') window.location.href = 'delivery.html';
                else if (data.role === 'vendor') window.location.href = 'vendor.html';
                else window.location.href = 'index.html';
            }, 600);
        } catch (err) {
            console.error(err);
            showMsg('Login failed.');
        }
    });

    const regForm = $('#register-form');
    if (regForm) regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(API + '/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: $('#reg-name').value.trim(),
                    email: $('#reg-email').value.trim(),
                    password: $('#reg-password').value,
                    role: $('#reg-role').value
                })
            });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);

            localStorage.setItem('token', data.token);
            localStorage.setItem('role', data.role);
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('userName', data.username);

            showMsg('Account created. Welcome, ' + data.username + '!', 'success');

            setTimeout(() => {
                if (data.role === 'admin') window.location.href = 'admin.html';
                else if (data.role === 'delivery') window.location.href = 'delivery.html';
                else if (data.role === 'vendor') window.location.href = 'vendor.html';
                else window.location.href = 'index.html';
            }, 600);
        } catch (err) {
            console.error(err);
            showMsg('Registration failed.');
        }
    });
}

// profile page logic (profile.html)


function initProfilePictureModal() {
    const overlay = $('#profile-pic-overlay');
    const popup = $('#profile-pic-popup');
    const viewOverlay = $('#profile-view-overlay');
    const viewPopup = $('#profile-view-popup');
    const viewFrame = $('#profile-view-frame');
    const viewImage = $('#profile-view-image');
    const viewCloseBtn = $('#profile-view-close');
    const viewZoom = $('#profile-view-zoom');
    const viewReset = $('#profile-view-reset');
    const cropOverlay = $('#profile-crop-overlay');
    const cropPopup = $('#profile-crop-popup');
    const cropImage = $('#profile-crop-image');
    const cropCloseBtn = $('#profile-crop-close');
    const cropCancelBtn = $('#profile-crop-cancel');
    const cropSaveBtn = $('#profile-crop-save');
    const fileInput = $('#profile-pic-input');
    const profileImg = $('#profile-img');
    const profilePictureContainer = $('#profile-picture-container');
    const profileEditIcon = $('#profile-edit-icon');
    const viewBtn = $('#profile-pic-view-btn');
    const uploadBtn = $('#profile-pic-upload-btn');
    const closeBtn = $('#profile-pic-popup-close');

    if (!popup || !fileInput || !profileImg) return;

    let cropper = null;
    let cropImageUrl = null;
    let pendingCropFile = null;
    let viewScale = 1;
    let viewTranslateX = 0;
    let viewTranslateY = 0;
    let isViewDragging = false;
    let viewDragStartX = 0;
    let viewDragStartY = 0;
    let viewPointerStartX = 0;
    let viewPointerStartY = 0;

    const cleanupCropper = () => {
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        if (cropImageUrl) {
            URL.revokeObjectURL(cropImageUrl);
            cropImageUrl = null;
        }
        if (cropImage) cropImage.removeAttribute('src');
        pendingCropFile = null;
    };

    const applyViewTransform = () => {
        if (!viewImage) return;
        viewImage.style.transform = `translate(${viewTranslateX}px, ${viewTranslateY}px) scale(${viewScale})`;
    };

    const resetViewTransform = () => {
        viewScale = 1;
        viewTranslateX = 0;
        viewTranslateY = 0;
        if (viewZoom) viewZoom.value = '1';
        applyViewTransform();
    };

    const closeViewPopup = () => {
        if (viewPopup && viewOverlay) PandaPopup.close(viewPopup, viewOverlay);
        resetViewTransform();
        if (viewImage) viewImage.removeAttribute('src');
    };

    const closeCropper = () => {
        if (cropPopup && cropOverlay) PandaPopup.close(cropPopup, cropOverlay);
        cleanupCropper();
        fileInput.value = '';
    };

    const getCroppedFileName = (file, mimeType) => {
        const base = file && file.name ? file.name.replace(/\.[^/.]+$/, '') : 'profile';
        const ext = mimeType === 'image/png' ? 'png' : 'jpg';
        return base + '.' + ext;
    };

    const openCropper = (file) => {
        if (!cropOverlay || !cropPopup || !cropImage) {
            showMsg('Cropper is unavailable right now.');
            return;
        }
        if (typeof Cropper === 'undefined') {
            showMsg('Image cropper failed to load. Please try again.');
            return;
        }

        pendingCropFile = file;
        PandaPopup.close(popup, overlay);
        cleanupCropper();

        cropImageUrl = URL.createObjectURL(file);
        cropImage.src = cropImageUrl;
        PandaPopup.open(cropPopup, cropOverlay);

        cropper = new Cropper(cropImage, {
            aspectRatio: 1,
            viewMode: 1,
            autoCropArea: 1,
            background: false,
            responsive: true,
            dragMode: 'move',
            guides: false,
            center: true,
            highlight: false,
            toggleDragModeOnDblclick: false
        });
    };

    // Open popup
    const openPopup = () => {
        PandaPopup.open(popup, overlay);
    };

    profilePictureContainer?.addEventListener('click', openPopup);
    profileEditIcon?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPopup();
    });

    // Close popup
    const closePopup = () => {
        PandaPopup.close(popup, overlay);
        setTimeout(() => {
            fileInput.value = '';
        }, 300);
    };

    closeBtn?.addEventListener('click', closePopup);
    overlay?.addEventListener('click', closePopup);

    cropCloseBtn?.addEventListener('click', closeCropper);
    cropCancelBtn?.addEventListener('click', closeCropper);
    cropOverlay?.addEventListener('click', closeCropper);

    // ESC to close
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (viewPopup && !viewPopup.classList.contains('hidden')) return closeViewPopup();
        if (cropPopup && !cropPopup.classList.contains('hidden')) return closeCropper();
        if (popup && !popup.classList.contains('hidden')) return closePopup();
    });

    // View button
    viewBtn?.addEventListener('click', () => {
        const imgSrc = profileImg.src;
        if (!imgSrc) return;
        closePopup();
        if (viewImage) viewImage.src = imgSrc;
        resetViewTransform();
        if (viewPopup && viewOverlay) PandaPopup.open(viewPopup, viewOverlay);
    });

    // Upload button
    uploadBtn?.addEventListener('click', () => {
        fileInput.click();
    });

    viewCloseBtn?.addEventListener('click', closeViewPopup);
    viewOverlay?.addEventListener('click', closeViewPopup);
    viewReset?.addEventListener('click', () => {
        resetViewTransform();
    });

    viewZoom?.addEventListener('input', () => {
        viewScale = Math.max(1, Math.min(3, Number(viewZoom.value) || 1));
        applyViewTransform();
    });

    viewFrame?.addEventListener('wheel', (event) => {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -0.08 : 0.08;
        viewScale = Math.max(1, Math.min(3, viewScale + delta));
        if (viewZoom) viewZoom.value = String(viewScale.toFixed(2));
        applyViewTransform();
    }, { passive: false });

    viewFrame?.addEventListener('pointerdown', (event) => {
        if (!viewFrame) return;
        isViewDragging = true;
        viewFrame.classList.add('is-dragging');
        viewPointerStartX = event.clientX;
        viewPointerStartY = event.clientY;
        viewDragStartX = viewTranslateX;
        viewDragStartY = viewTranslateY;
        viewFrame.setPointerCapture(event.pointerId);
    });

    viewFrame?.addEventListener('pointermove', (event) => {
        if (!isViewDragging) return;
        const dx = event.clientX - viewPointerStartX;
        const dy = event.clientY - viewPointerStartY;
        viewTranslateX = viewDragStartX + dx;
        viewTranslateY = viewDragStartY + dy;
        applyViewTransform();
    });

    const stopViewDrag = (event) => {
        if (!viewFrame) return;
        if (event && viewFrame.hasPointerCapture(event.pointerId)) {
            viewFrame.releasePointerCapture(event.pointerId);
        }
        isViewDragging = false;
        viewFrame.classList.remove('is-dragging');
    };

    viewFrame?.addEventListener('pointerup', stopViewDrag);
    viewFrame?.addEventListener('pointerleave', stopViewDrag);
    viewFrame?.addEventListener('pointercancel', stopViewDrag);

    // Handle file selection
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        openCropper(file);
    });

    cropSaveBtn?.addEventListener('click', async () => {
        if (!cropper) return;
        const originalText = cropSaveBtn.textContent;
        cropSaveBtn.disabled = true;
        cropSaveBtn.textContent = 'Uploading...';

        const mimeType = pendingCropFile && pendingCropFile.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const canvas = cropper.getCroppedCanvas({
            width: 1024,
            height: 1024,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        });

        if (!canvas) {
            showMsg('Failed to crop image.');
            cropSaveBtn.disabled = false;
            cropSaveBtn.textContent = originalText;
            return;
        }

        canvas.toBlob(async (blob) => {
            if (!blob) {
                showMsg('Failed to crop image.');
                cropSaveBtn.disabled = false;
                cropSaveBtn.textContent = originalText;
                return;
            }

            try {
                const fd = new FormData();
                const filename = getCroppedFileName(pendingCropFile, mimeType);
                fd.append('profile_picture', blob, filename);

                const res = await fetch(API + '/users/profile', {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: fd
                });
                const data = await res.json();
                if (!res.ok) return showMsg(data.error);
                showMsg('Profile picture updated!', 'success');

                const res2 = await fetch(API + '/users/profile', { headers: authHeaders() });
                const u2 = await res2.json();
                if (u2.profile_image) {
                    profileImg.src = u2.profile_image + '?t=' + Date.now();
                }
                closeCropper();
            } catch (err) {
                console.error(err);
                showMsg('Failed to upload profile picture.');
            } finally {
                cropSaveBtn.disabled = false;
                cropSaveBtn.textContent = originalText;
            }
        }, mimeType, 0.92);
    });
}

async function initProfile() {
    if (!getToken()) return window.location.href = 'login.html';

    try {
        const res = await fetch(API + '/users/profile', { headers: authHeaders() });
        const user = await res.json();
        if (!res.ok) return showMsg(user.error);

        $('#profile-name').value = user.username || '';
        $('#profile-email').value = user.email || '';
        if ($('#profile-fullname')) $('#profile-fullname').value = user.full_name || '';
        if ($('#profile-phone')) $('#profile-phone').value = user.phone || '';
        if ($('#profile-address')) $('#profile-address').value = user.address || '';
        if (user.profile_image) {
            $('#profile-img').src = user.profile_image;
        }
    } catch (err) {
        console.error(err);
    }

    // Initialize profile picture modal
    initProfilePictureModal();

    $('#profile-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const fd = new FormData();
            fd.append('username', $('#profile-name').value.trim());
            fd.append('email', $('#profile-email').value.trim());
            const pw = $('#profile-password').value;
            const confirmPw = $('#profile-password-confirm') ? $('#profile-password-confirm').value : '';

            if (pw || confirmPw) {
                if (!pw || !confirmPw) {
                    return showMsg('Please fill both password fields.');
                }
                if (pw !== confirmPw) {
                    return showMsg('New password and confirm password do not match.');
                }
            }

            if (pw) fd.append('password', pw);
            if ($('#profile-fullname')) fd.append('full_name', $('#profile-fullname').value.trim());
            if ($('#profile-phone')) fd.append('phone', $('#profile-phone').value.trim());
            if ($('#profile-address')) fd.append('address', $('#profile-address').value.trim());
            const fileInput = $('#profile-pic-input');
            if (fileInput.files[0]) fd.append('profile_picture', fileInput.files[0]);

            const res = await fetch(API + '/users/profile', {
                method: 'PUT',
                headers: authHeaders(),
                body: fd
            });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg('Profile updated!', 'success');
            if ($('#profile-password')) $('#profile-password').value = '';
            if ($('#profile-password-confirm')) $('#profile-password-confirm').value = '';
            // reload profile image preview
            const res2 = await fetch(API + '/users/profile', { headers: authHeaders() });
            const u2 = await res2.json();
            if (u2.profile_image) $('#profile-img').src = u2.profile_image + '?t=' + Date.now();
        } catch (err) {
            console.error(err);
            showMsg('Update failed.');
        }
    });
}

// my orders page logic (my-orders.html)

function initMyOrders() {
    if (!getToken()) return window.location.href = 'login.html';
    fetchMyOrders();
    // auto refresh orders every 5 seconds
    setInterval(fetchMyOrders, 5000);
}

async function fetchMyOrders() {
    try {
        const res = await fetch(API + '/orders/mine', { headers: authHeaders() });
        if (!res.ok) return;
        const orders = await res.json();

        const container = $('#orders-list');
        const tpl = $('#order-card-template');
        if (!orders.length) {
            container.innerHTML = '<div class="empty-state"><p>You haven\'t placed any orders yet.</p><a href="index.html" class="btn btn-primary btn-sm mt-2">Browse Menu</a></div>';
            return;
        }

        container.innerHTML = '';
        orders.forEach(order => {
            const clone = tpl.content.cloneNode(true);
            clone.querySelector('.order-id').textContent = order.id;
            const badge = clone.querySelector('.order-status');
            badge.textContent = formatStatus(order.status);
            badge.className = badgeCls(order.status);
            clone.querySelector('.order-delivery').textContent = order.delivery_person || 'Not assigned';

            // show OTP box when the order is out for delivery
            const otpBox = clone.querySelector('.otp-box');
            const otpEl = clone.querySelector('.order-otp');
            if (otpBox && otpEl && order.delivery_otp && !['delivered', 'cancelled'].includes(order.status)) {
                otpEl.textContent = order.delivery_otp;
                otpBox.classList.remove('hidden');
            }

            const tbody = clone.querySelector('.order-items');
            let total = 0;
            order.items.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${item.name}</td><td>${item.quantity}</td><td>${formatPrice(item.price * item.quantity)}</td>`;
                tbody.appendChild(tr);
                total += item.price * item.quantity;
            });
            clone.querySelector('.order-total').textContent = 'Total: ' + formatPrice(order.total_amount || total);
            container.appendChild(clone);
        });
    } catch (err) {
        console.error(err);
    }
}

// delivery page logic (delivery.html)

let deliveryMap = null;
let deliveryMarkers = [];
let selectedOrderMap = null;
let selectedOrderMarker = null;
let selectedOrderRouteLayer = null;
let selectedRiderMarker = null;
let deliveryRouteLayers = [];
let deliveryRouteStopMarkers = [];
let deliveryRiderMarker = null;
let riderCurrentLocation = null;

function initDelivery() {
    if (!getToken()) return window.location.href = 'login.html';
    window._deliveryMapNeedsInit = true;

    const selectedUseLocationBtn = $('#selected-route-use-location');
    if (selectedUseLocationBtn) {
        selectedUseLocationBtn.addEventListener('click', async () => {
            const pos = await getRiderLocation();
            if (pos && window._selectedPendingOrderForMap) {
                const coords = parseDeliveryCoords(window._selectedPendingOrderForMap.delivery_address);
                if (coords) drawSelectedOrderRoute(coords, window._selectedPendingOrderForMap);
            }
        });
    }

    const useLocationBtn = $('#multi-route-use-location');
    if (useLocationBtn) {
        useLocationBtn.addEventListener('click', async () => {
            const pos = await getRiderLocation();
            if (pos) showMsg('Rider location updated.', 'success');
        });
    }

    const buildRouteBtn = $('#multi-route-build');
    if (buildRouteBtn) {
        buildRouteBtn.addEventListener('click', () => {
            buildMultiStopRoute();
        });
    }

    const routeModeSelect = $('#multi-route-mode');
    if (routeModeSelect) {
        routeModeSelect.addEventListener('change', () => {
            renderMultiRouteOrderList();
        });
    }

    loadPendingOrders();
    loadDeliveryHistory();
}

async function loadPendingOrders() {
    try {
        const res = await fetch(API + '/delivery/pending', { headers: authHeaders() });
        if (!res.ok) return;
        const orders = await res.json();

        const container = $('#pending-orders');
        const tpl = $('#delivery-order-template');
        const selectedMapWrap = $('#selected-order-map-wrap');
        if (!orders.length) {
            container.innerHTML = '<div class="empty-state"><p>No pending orders right now.</p></div>';
            if (selectedMapWrap) selectedMapWrap.classList.add('hidden');
            return;
        }

        container.innerHTML = '';
        let firstOrderWithLocation = null;

        orders.forEach(order => {
            const clone = tpl.content.cloneNode(true);
            clone.querySelector('.order-id').textContent = order.id;
            const badge = clone.querySelector('.order-status');
            badge.textContent = formatStatus(order.status);
            badge.className = badgeCls(order.status);
            clone.querySelector('.order-customer').textContent = order.customer_name || '—';
            clone.querySelector('.order-coords').textContent = order.delivery_address || 'N/A';

            const tbody = clone.querySelector('.order-items');
            order.items.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${item.name}</td><td>${item.quantity}</td><td>${formatPrice(item.price * item.quantity)}</td>`;
                tbody.appendChild(tr);
            });

            const updateBtn = clone.querySelector('.update-status-btn');
            const selectEl = clone.querySelector('.order-status-select');
            updateBtn.addEventListener('click', () => updateOrderStatus(order.id, selectEl.value));

            const cardRoot = clone.querySelector('.delivery-order-card');
            if (cardRoot) {
                cardRoot.addEventListener('click', (e) => {
                    if (e.target.closest('.update-status-btn') || e.target.closest('.order-status-select') || e.target.closest('[data-custom-dropdown]')) return;
                    showSelectedPendingOrderOnMap(order, cardRoot, { scrollToMap: true });
                });
            }

            if (!firstOrderWithLocation && parseDeliveryCoords(order.delivery_address)) {
                firstOrderWithLocation = order;
            }

            container.appendChild(clone);
        });

        if (selectedMapWrap) {
            if (firstOrderWithLocation) {
                const firstCard = container.querySelector('.delivery-order-card');
                showSelectedPendingOrderOnMap(firstOrderWithLocation, firstCard);
            } else {
                selectedMapWrap.classList.add('hidden');
            }
        }

        // save order coordinates for map tab
        window._pendingOrders = orders;

        const ids = orders
            .filter((o) => parseDeliveryCoords(o.delivery_address))
            .map((o) => o.id);
        if (!Array.isArray(window._manualRouteOrderIds) || !window._manualRouteOrderIds.length) {
            window._manualRouteOrderIds = ids;
        } else {
            const kept = window._manualRouteOrderIds.filter((id) => ids.includes(id));
            const missing = ids.filter((id) => !kept.includes(id));
            window._manualRouteOrderIds = kept.concat(missing);
        }

        renderMultiRouteOrderList();
    } catch (err) {
        console.error(err);
    }
}

function parseDeliveryCoords(deliveryAddress) {
    if (!deliveryAddress) return null;
    const parts = deliveryAddress.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
    return { lat: parts[0], lng: parts[1] };
}

function formatDistanceMeters(meters) {
    if (!Number.isFinite(meters)) return '0 km';
    const km = meters / 1000;
    return km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(1)} km`;
}

function formatDurationSeconds(seconds) {
    if (!Number.isFinite(seconds)) return '0 min';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function summarizeRouteLine(distance, duration) {
    return `<strong>Distance:</strong> ${formatDistanceMeters(distance)} &nbsp;•&nbsp; <strong>ETA:</strong> ${formatDurationSeconds(duration)}`;
}

function toLegInstruction(step) {
    if (!step) return 'Continue';
    if (step.maneuver && step.maneuver.instruction) return step.maneuver.instruction;

    const type = step.maneuver && step.maneuver.type ? step.maneuver.type : 'continue';
    const modifier = step.maneuver && step.maneuver.modifier ? ` ${step.maneuver.modifier}` : '';
    const road = step.name ? ` on ${step.name}` : '';
    return `${type}${modifier}${road}`.replace(/^./, (c) => c.toUpperCase());
}

async function fetchOsrmRoute(points, includeSteps = true) {
    if (!Array.isArray(points) || points.length < 2) return null;

    const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${OSRM_ROUTE_URL}/${coordStr}?overview=full&geometries=geojson&steps=${includeSteps ? 'true' : 'false'}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data || data.code !== 'Ok' || !data.routes || !data.routes.length) return null;
    return data.routes[0];
}

async function getRiderLocation() {
    if (!navigator.geolocation) {
        showMsg('Geolocation is not supported on this browser.');
        return null;
    }

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition((pos) => {
            riderCurrentLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            };
            resolve(riderCurrentLocation);
        }, () => {
            showMsg('Could not read your current location. Allow location permission.');
            resolve(null);
        }, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 40000
        });
    });
}

function showSelectedPendingOrderOnMap(order, selectedCardEl, opts = {}) {
    const mapWrap = $('#selected-order-map-wrap');
    const mapEl = document.getElementById('selected-order-map');
    if (!mapWrap || !mapEl || typeof L === 'undefined') return;

    const coords = parseDeliveryCoords(order.delivery_address);
    if (!coords) {
        mapWrap.classList.add('hidden');
        return;
    }

    window._selectedPendingOrderForMap = order;

    mapWrap.classList.remove('hidden');

    if (opts.scrollToMap && window.innerWidth <= 1024) {
        mapWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    document.querySelectorAll('.delivery-order-card.is-selected').forEach(card => {
        card.classList.remove('is-selected');
    });
    if (selectedCardEl) selectedCardEl.classList.add('is-selected');

    if (!selectedOrderMap) {
        selectedOrderMap = L.map('selected-order-map').setView([coords.lat, coords.lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(selectedOrderMap);
    }

    if (selectedOrderMarker) {
        selectedOrderMap.removeLayer(selectedOrderMarker);
        selectedOrderMarker = null;
    }

    selectedOrderMarker = createProfilePinMarker(selectedOrderMap, coords.lat, coords.lng, {
        imageUrl: order.customer_profile_image,
        name: order.customer_name || 'Customer',
        popupText: `Order #${order.id} - ${order.customer_name || 'Customer'}`,
        openPopup: true
    });

    selectedOrderMap.setView([coords.lat, coords.lng], 15);
    setTimeout(() => selectedOrderMap.invalidateSize(), 180);

    drawSelectedOrderRoute(coords, order);
}

async function drawSelectedOrderRoute(destination, order) {
    const summaryEl = $('#selected-route-summary');
    const stepsEl = $('#selected-route-steps');
    if (!selectedOrderMap || !summaryEl || !stepsEl || !destination) return;

    if (!riderCurrentLocation) {
        const pos = await getRiderLocation();
        if (!pos) {
            summaryEl.classList.remove('hidden');
            summaryEl.innerHTML = '<strong>Tip:</strong> Tap <em>Use My Location</em> to draw route + ETA.';
            stepsEl.classList.add('hidden');
            stepsEl.innerHTML = '';
            return;
        }
    }

    const route = await fetchOsrmRoute([riderCurrentLocation, destination], true);
    if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates)) {
        summaryEl.classList.remove('hidden');
        summaryEl.innerHTML = '<strong>Route unavailable.</strong> You can still navigate using the delivery pin.';
        stepsEl.classList.add('hidden');
        stepsEl.innerHTML = '';
        return;
    }

    if (selectedOrderRouteLayer) {
        selectedOrderMap.removeLayer(selectedOrderRouteLayer);
        selectedOrderRouteLayer = null;
    }

    if (selectedRiderMarker) {
        selectedOrderMap.removeLayer(selectedRiderMarker);
        selectedRiderMarker = null;
    }

    selectedRiderMarker = L.circleMarker([riderCurrentLocation.lat, riderCurrentLocation.lng], {
        radius: 7,
        color: '#0F766E',
        weight: 2,
        fillColor: '#14B8A6',
        fillOpacity: 0.95
    }).addTo(selectedOrderMap).bindPopup('Your current location');

    const latLngs = route.geometry.coordinates.map((c) => [c[1], c[0]]);
    selectedOrderRouteLayer = L.polyline(latLngs, {
        color: '#C62828',
        weight: 5,
        opacity: 0.88
    }).addTo(selectedOrderMap);

    const group = L.featureGroup([selectedOrderMarker, selectedRiderMarker, selectedOrderRouteLayer]);
    selectedOrderMap.fitBounds(group.getBounds().pad(0.14));

    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `<strong>Order #${order.id} (${order.customer_name || 'Customer'})</strong><br>${summarizeRouteLine(route.distance, route.duration)}`;

    const steps = (route.legs && route.legs[0] && route.legs[0].steps) ? route.legs[0].steps : [];
    if (!steps.length) {
        stepsEl.classList.add('hidden');
        stepsEl.innerHTML = '';
        return;
    }

    stepsEl.classList.remove('hidden');
    stepsEl.innerHTML = steps.map((step) => `<li><strong>${toLegInstruction(step)}</strong> <span class="text-muted">(${formatDistanceMeters(step.distance)})</span></li>`).join('');
}

async function loadDeliveryHistory() {
    try {
        const res = await fetch(API + '/delivery/history', { headers: authHeaders() });
        if (!res.ok) return;
        const orders = await res.json();

        const container = $('#history-orders');
        const tpl = $('#delivery-order-template');
        if (!orders.length) {
            container.innerHTML = '<div class="empty-state"><p>No deliveries completed yet.</p></div>';
            return;
        }

        container.innerHTML = '';
        orders.forEach(order => {
            const clone = tpl.content.cloneNode(true);
            clone.querySelector('.order-id').textContent = order.id;
            const badge = clone.querySelector('.order-status');
            badge.textContent = formatStatus(order.status);
            badge.className = badgeCls(order.status);
            clone.querySelector('.order-customer').textContent = order.customer_name || '—';
            clone.querySelector('.order-coords').textContent = order.delivery_address || 'N/A';

            const tbody = clone.querySelector('.order-items');
            order.items.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${item.name}</td><td>${item.quantity}</td><td>${formatPrice(item.price * item.quantity)}</td>`;
                tbody.appendChild(tr);
            });

            // hide update buttons on history cards
            clone.querySelector('.order-status-select').style.display = 'none';
            clone.querySelector('.update-status-btn').style.display = 'none';

            container.appendChild(clone);
        });
    } catch (err) {
        console.error(err);
    }
}

function initDeliveryMap() {
    window._deliveryMapNeedsInit = false;
    const mapEl = document.getElementById('delivery-map');
    if (!mapEl || typeof L === 'undefined') return;

    if (!deliveryMap) {
        deliveryMap = L.map('delivery-map').setView([23.8103, 90.4125], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(deliveryMap);
    }

    // clear old markers before adding new ones
    deliveryMarkers.forEach(m => deliveryMap.removeLayer(m));
    deliveryMarkers = [];

    deliveryRouteLayers.forEach((layer) => deliveryMap.removeLayer(layer));
    deliveryRouteLayers = [];

    deliveryRouteStopMarkers.forEach((marker) => deliveryMap.removeLayer(marker));
    deliveryRouteStopMarkers = [];

    if (deliveryRiderMarker) {
        deliveryMap.removeLayer(deliveryRiderMarker);
        deliveryRiderMarker = null;
    }

    const orders = window._pendingOrders || [];
    orders.forEach(o => {
        if (o.delivery_address) {
            const parts = o.delivery_address.split(',').map(s => parseFloat(s.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                const m = createProfilePinMarker(deliveryMap, parts[0], parts[1], {
                    imageUrl: o.customer_profile_image,
                    name: o.customer_name || 'Customer',
                    popupText: `Order #${o.id} — ${o.customer_name || 'Customer'}`
                });
                deliveryMarkers.push(m);
            }
        }
    });

    if (deliveryMarkers.length) {
        const group = L.featureGroup(deliveryMarkers);
        deliveryMap.fitBounds(group.getBounds().pad(0.2));
    }

    if (riderCurrentLocation) {
        deliveryRiderMarker = L.circleMarker([riderCurrentLocation.lat, riderCurrentLocation.lng], {
            radius: 7,
            color: '#0F766E',
            weight: 2,
            fillColor: '#14B8A6',
            fillOpacity: 0.95
        }).addTo(deliveryMap).bindPopup('Your current location');
    }

    setTimeout(() => deliveryMap.invalidateSize(), 200);
}

function renderMultiRouteOrderList() {
    const listEl = $('#multi-route-orders');
    const modeEl = $('#multi-route-mode');
    if (!listEl || !modeEl) return;

    const stops = (window._pendingOrders || [])
        .map((order) => ({ order, coords: parseDeliveryCoords(order.delivery_address) }))
        .filter((entry) => !!entry.coords);

    if (!stops.length) {
        listEl.classList.add('hidden');
        listEl.innerHTML = '';
        return;
    }

    const manualMode = modeEl.value === 'manual';
    listEl.classList.remove('hidden');

    if (!manualMode) {
        listEl.innerHTML = `<div class="route-order-row"><div class="route-order-meta"><strong>${stops.length} stops ready</strong><span>Auto mode picks nearest next stop from your current location.</span></div></div>`;
        return;
    }

    if (!Array.isArray(window._manualRouteOrderIds) || !window._manualRouteOrderIds.length) {
        window._manualRouteOrderIds = stops.map((s) => s.order.id);
    }

    const orderedStops = window._manualRouteOrderIds
        .map((id) => stops.find((entry) => entry.order.id === id))
        .filter(Boolean);

    listEl.innerHTML = orderedStops.map((entry, index) => {
        const order = entry.order;
        return `
            <div class="route-order-row" data-order-id="${order.id}">
                <div class="route-order-meta">
                    <strong>${index + 1}. Order #${order.id} - ${order.customer_name || 'Customer'}</strong>
                    <span>${order.delivery_address || 'N/A'}</span>
                </div>
                <div class="route-order-actions">
                    <button class="btn btn-secondary btn-sm move-up" type="button" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button class="btn btn-secondary btn-sm move-down" type="button" ${index === orderedStops.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.route-order-row').forEach((row, idx) => {
        const orderId = Number(row.dataset.orderId);
        const upBtn = row.querySelector('.move-up');
        const downBtn = row.querySelector('.move-down');
        if (upBtn) upBtn.addEventListener('click', () => moveManualRouteOrder(orderId, idx - 1));
        if (downBtn) downBtn.addEventListener('click', () => moveManualRouteOrder(orderId, idx + 1));
    });
}

function moveManualRouteOrder(orderId, newIndex) {
    if (!Array.isArray(window._manualRouteOrderIds)) return;
    const oldIndex = window._manualRouteOrderIds.indexOf(orderId);
    if (oldIndex < 0 || newIndex < 0 || newIndex >= window._manualRouteOrderIds.length) return;

    window._manualRouteOrderIds.splice(oldIndex, 1);
    window._manualRouteOrderIds.splice(newIndex, 0, orderId);
    renderMultiRouteOrderList();
}

function orderStopsByNearest(startPoint, stops) {
    const remaining = stops.slice();
    const ordered = [];
    let current = startPoint;

    while (remaining.length) {
        let nearestIdx = 0;
        let nearestDist = Number.POSITIVE_INFINITY;

        remaining.forEach((stop, idx) => {
            const dLat = current.lat - stop.coords.lat;
            const dLng = current.lng - stop.coords.lng;
            const dist = (dLat * dLat) + (dLng * dLng);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestIdx = idx;
            }
        });

        const next = remaining.splice(nearestIdx, 1)[0];
        ordered.push(next);
        current = next.coords;
    }

    return ordered;
}

async function buildMultiStopRoute() {
    const modeEl = $('#multi-route-mode');
    const summaryEl = $('#multi-route-summary');
    const stepsEl = $('#multi-route-steps');
    if (!modeEl || !summaryEl || !stepsEl) return;

    if (!deliveryMap) initDeliveryMap();
    if (!deliveryMap) return;

    const allStops = (window._pendingOrders || [])
        .map((order) => ({ order, coords: parseDeliveryCoords(order.delivery_address) }))
        .filter((entry) => !!entry.coords);

    if (!allStops.length) {
        showMsg('No valid order coordinates found for route building.');
        return;
    }

    if (!riderCurrentLocation) {
        const pos = await getRiderLocation();
        if (!pos) return;
    }

    const manualMode = modeEl.value === 'manual';
    let orderedStops = [];

    if (manualMode) {
        if (!Array.isArray(window._manualRouteOrderIds) || !window._manualRouteOrderIds.length) {
            window._manualRouteOrderIds = allStops.map((s) => s.order.id);
        }
        orderedStops = window._manualRouteOrderIds
            .map((id) => allStops.find((entry) => entry.order.id === id))
            .filter(Boolean);
    } else {
        orderedStops = orderStopsByNearest(riderCurrentLocation, allStops);
    }

    if (!orderedStops.length) {
        showMsg('No stops available for route building.');
        return;
    }

    deliveryRouteLayers.forEach((layer) => deliveryMap.removeLayer(layer));
    deliveryRouteLayers = [];
    deliveryRouteStopMarkers.forEach((marker) => deliveryMap.removeLayer(marker));
    deliveryRouteStopMarkers = [];
    deliveryMarkers.forEach((marker) => deliveryMap.removeLayer(marker));
    deliveryMarkers = [];

    if (deliveryRiderMarker) {
        deliveryMap.removeLayer(deliveryRiderMarker);
    }

    deliveryRiderMarker = L.circleMarker([riderCurrentLocation.lat, riderCurrentLocation.lng], {
        radius: 7,
        color: '#0F766E',
        weight: 2,
        fillColor: '#14B8A6',
        fillOpacity: 0.95
    }).addTo(deliveryMap).bindPopup('Start: your current location');

    const colors = ['#C62828', '#B91C1C', '#0F766E', '#1D4ED8', '#7C3AED', '#D97706'];
    let totalDistance = 0;
    let totalDuration = 0;
    const allStepItems = [];

    let currentPoint = riderCurrentLocation;
    for (let i = 0; i < orderedStops.length; i++) {
        const stop = orderedStops[i];
        const route = await fetchOsrmRoute([currentPoint, stop.coords], true);
        if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates)) continue;

        totalDistance += Number(route.distance || 0);
        totalDuration += Number(route.duration || 0);

        const latLngs = route.geometry.coordinates.map((c) => [c[1], c[0]]);
        const line = L.polyline(latLngs, {
            color: colors[i % colors.length],
            weight: 5,
            opacity: 0.9
        }).addTo(deliveryMap);
        deliveryRouteLayers.push(line);

        const stopMarker = createProfilePinMarker(deliveryMap, stop.coords.lat, stop.coords.lng, {
            imageUrl: stop.order.customer_profile_image,
            name: stop.order.customer_name || 'Customer',
            popupText: `Stop ${i + 1}: Order #${stop.order.id} - ${stop.order.customer_name || 'Customer'}`
        });
        deliveryRouteStopMarkers.push(stopMarker);

        const legSteps = (route.legs && route.legs[0] && route.legs[0].steps) ? route.legs[0].steps : [];
        allStepItems.push(`<li><strong>Leg ${i + 1} - Order #${stop.order.id}</strong> <span class="text-muted">(${formatDistanceMeters(route.distance)} / ${formatDurationSeconds(route.duration)})</span></li>`);
        legSteps.forEach((step) => {
            allStepItems.push(`<li>${toLegInstruction(step)} <span class="text-muted">(${formatDistanceMeters(step.distance)})</span></li>`);
        });

        currentPoint = stop.coords;
    }

    const allLayers = [deliveryRiderMarker].concat(deliveryRouteLayers, deliveryRouteStopMarkers).filter(Boolean);
    if (allLayers.length) {
        const group = L.featureGroup(allLayers);
        deliveryMap.fitBounds(group.getBounds().pad(0.18));
    }

    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `<strong>${manualMode ? 'Manual' : 'Auto'} route ready:</strong> ${orderedStops.length} stops<br>${summarizeRouteLine(totalDistance, totalDuration)}`;

    if (allStepItems.length) {
        stepsEl.classList.remove('hidden');
        stepsEl.innerHTML = allStepItems.join('');
    } else {
        stepsEl.classList.add('hidden');
        stepsEl.innerHTML = '';
    }

    setTimeout(() => deliveryMap.invalidateSize(), 150);
}

async function updateOrderStatus(orderId, status) {
    if (!status) return showMsg('Select a status first.');

    // if marking as delivered, show OTP verification modal first
    if (status === 'delivered') {
        showOtpModal(orderId);
        return;
    }

    try {
        const res = await fetch(API + '/orders/' + orderId + '/status', {
            method: 'PUT',
            headers: authJSON(),
            body: JSON.stringify({ status })
        });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);

        showMsg('Order #' + orderId + ' → ' + formatStatus(status), 'success');
        loadPendingOrders();
        loadDeliveryHistory();
    } catch (err) {
        console.error(err);
        showMsg('Update failed.');
    }
}

function showOtpModal(orderId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:90%;max-width:420px;">
            <div class="modal-header">
                <h5 style="margin:0;display:flex;align-items:center;gap:.5rem;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Enter Delivery OTP
                </h5>
                <button type="button" class="close-modal" style="background:none;border:none;font-size:1.5rem;cursor:pointer;">&times;</button>
            </div>
            <div class="modal-body" style="padding:1.25rem;">
                <p style="margin:0 0 1rem 0;color:var(--text-muted,#666);font-size:.9rem;">Ask the customer for their 4-digit delivery code and enter it below to confirm delivery.</p>
                <div class="otp-input-row">
                    <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="_ _ _ _" class="otp-entry form-control" style="text-align:center;font-size:1.75rem;letter-spacing:.4em;font-weight:700;width:100%;" autocomplete="off" aria-label="4-digit delivery OTP code" />
                </div>
                <p class="otp-error-msg" style="color:#dc2626;font-size:.85rem;margin:.5rem 0 0 0;display:none;"></p>
            </div>
            <div class="modal-footer" style="padding:1rem;display:flex;gap:.5rem;justify-content:flex-end;border-top:1px solid #e5e7eb;">
                <button class="btn btn-secondary cancel-otp-btn">Cancel</button>
                <button class="btn btn-primary confirm-otp-btn">Confirm Delivery</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('.otp-entry');
    const errorMsg = modal.querySelector('.otp-error-msg');
    const confirmBtn = modal.querySelector('.confirm-otp-btn');

    modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
    modal.querySelector('.cancel-otp-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    input.focus();

    confirmBtn.addEventListener('click', async () => {
        const otp = input.value.trim();
        if (otp.length !== 4 || !/^\d{4}$/.test(otp)) {
            errorMsg.textContent = 'Please enter a valid 4-digit code.';
            errorMsg.style.display = 'block';
            return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Verifying…';
        errorMsg.style.display = 'none';
        try {
            const res = await fetch(API + '/orders/' + orderId + '/status', {
                method: 'PUT',
                headers: authJSON(),
                body: JSON.stringify({ status: 'delivered', otp })
            });
            const data = await res.json();
            if (!res.ok) {
                errorMsg.textContent = data.error || 'OTP verification failed.';
                errorMsg.style.display = 'block';
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Confirm Delivery';
                return;
            }
            modal.remove();
            showMsg('Order #' + orderId + ' marked as delivered!', 'success');
            loadPendingOrders();
            loadDeliveryHistory();
        } catch (err) {
            console.error(err);
            errorMsg.textContent = 'Request failed. Please try again.';
            errorMsg.style.display = 'block';
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Delivery';
        }
    });
}

// admin page logic (admin.html)

function initAdmin() {
    if (!getToken() || getRole() !== 'admin') return window.location.href = 'login.html';

    adminLoadUsers();
    adminLoadRestaurants();
    adminLoadItems();
    adminLoadOrders();
    adminPopulateStats();
    adminLoadPendingApprovals();
    adminRefreshVendorSelects();
    adminInitActivityLog();

// admin users section functions
    const cancelEditUser = $('#cancel-edit-user');
    if (cancelEditUser) cancelEditUser.addEventListener('click', () => PandaPopup.close($('#edit-user-card')));

    const editUserForm = $('#edit-user-form');
    if (editUserForm) editUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#edit-user-id').value;
        try {
            const res = await fetch(API + '/users/' + id, {
                method: 'PUT',
                headers: authJSON(),
                body: JSON.stringify({
                    username: $('#edit-user-name').value.trim(),
                    email: $('#edit-user-email').value.trim(),
                    role: $('#edit-user-role').value
                })
            });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg('User updated!', 'success');
            PandaPopup.close($('#edit-user-card'));
            adminLoadUsers();
        } catch (err) { showMsg('Update failed.'); }
    });

// admin restaurants section functions
    const addRestForm = $('#add-restaurant-form');
    if (addRestForm) addRestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.append('name', $('#rest-name').value.trim());
        const ownerUsername = $('#rest-owner-username').value;
        if (ownerUsername) fd.append('owner_username', ownerUsername);
        const file = $('#rest-banner').files[0];
        if (file) fd.append('banner', file);
        try {
            const res = await fetch(API + '/restaurants', { method: 'POST', headers: authHeaders(), body: fd });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg('Restaurant added!', 'success');
            addRestForm.reset();
            adminLoadRestaurants();
            adminRefreshRestaurantSelects();
        } catch (err) { showMsg('Add failed.'); }
    });

    const cancelEditRest = $('#cancel-edit-rest');
    if (cancelEditRest) cancelEditRest.addEventListener('click', () => PandaPopup.close($('#edit-restaurant-card')));

    const editRestForm = $('#edit-restaurant-form');
    if (editRestForm) editRestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#edit-rest-id').value;
        const fd = new FormData();
        fd.append('name', $('#edit-rest-name').value.trim());
        fd.append('owner_username', $('#edit-rest-owner-username').value);
        const file = $('#edit-rest-banner').files[0];
        if (file) fd.append('banner', file);
        try {
            const res = await fetch(API + '/restaurants/' + id, { method: 'PUT', headers: authHeaders(), body: fd });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg('Restaurant updated!', 'success');
            PandaPopup.close($('#edit-restaurant-card'));
            adminLoadRestaurants();
        } catch (err) { showMsg('Update failed.'); }
    });

// admin menu items section functions
    const addItemForm = $('#add-item-form');
    if (addItemForm) addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.append('restaurant_id', $('#item-restaurant').value);
        fd.append('name', $('#item-name').value.trim());
        fd.append('description', $('#item-description').value.trim());
        fd.append('price', $('#item-price').value);
        const file = $('#item-banner').files[0];
        if (file) fd.append('banner', file);
        try {
            const res = await fetch(API + '/menu-items', { method: 'POST', headers: authHeaders(), body: fd });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg('Item added!', 'success');
            addItemForm.reset();
            adminLoadItems();
        } catch (err) { showMsg('Add failed.'); }
    });

    const cancelEditItem = $('#cancel-edit-item');
    if (cancelEditItem) cancelEditItem.addEventListener('click', () => PandaPopup.close($('#edit-item-card')));

    const editItemForm = $('#edit-item-form');
    if (editItemForm) editItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#edit-item-id').value;
        const fd = new FormData();
        fd.append('restaurant_id', $('#edit-item-restaurant').value);
        fd.append('name', $('#edit-item-name').value.trim());
        fd.append('description', $('#edit-item-description').value.trim());
        fd.append('price', $('#edit-item-price').value);
        const file = $('#edit-item-banner').files[0];
        if (file) fd.append('banner', file);
        try {
            const res = await fetch(API + '/menu-items/' + id, { method: 'PUT', headers: authHeaders(), body: fd });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg('Item updated!', 'success');
            PandaPopup.close($('#edit-item-card'));
            adminLoadItems();
        } catch (err) { showMsg('Update failed.'); }
    });

    // fill restaurant dropdowns when page loads
    adminRefreshRestaurantSelects();
}

// admin users section functions

async function adminLoadUsers() {
    try {
        const res = await fetch(API + '/users', { headers: authHeaders() });
        if (!res.ok) {
            const error = await res.json();
            return showMsg(error.error || 'Failed to load users.');
        }
        const users = await res.json();

        const tbody = $('#users-tbody');
        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.id || u.username}</td>
                <td>${u.username}</td>
                <td>${u.email}</td>
                <td><span class="${badgeCls(u.role)}">${u.role}</span></td>
                <td class="gap-row">
                    <button class="btn btn-sm btn-primary" onclick="adminEditUser('${u.username.replace(/'/g,"\\'") }', '${u.username.replace(/'/g,"\\'") }', '${u.email.replace(/'/g,"\\'") }', '${u.role}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="adminDeleteUser('${u.username.replace(/'/g,"\\'") }')">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) { console.error(err); }
}

window.adminEditUser = (userKey, username, email, role) => {
    PandaPopup.open($('#edit-user-card'));
    $('#edit-user-id').value = userKey;
    $('#edit-user-name').value = username;
    $('#edit-user-email').value = email;
    $('#edit-user-role').value = role;
};

window.adminDeleteUser = async (userKey) => {
    if (!confirm('Delete user ' + userKey + '?')) return;
    try {
        const res = await fetch(API + '/users/' + encodeURIComponent(userKey), { method: 'DELETE', headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);
        showMsg('User deleted.', 'success');
        adminLoadUsers();
    } catch (err) { showMsg('Delete failed.'); }
};

    // admin restaurants section functions

async function adminLoadRestaurants() {
    try {
        const res = await fetch(API + '/restaurants', { headers: authHeaders() });
        if (!res.ok) {
            const error = await res.json();
            return showMsg(error.error || 'Failed to load restaurants.');
        }
        const list = await res.json();

        const tbody = $('#restaurants-tbody');
        tbody.innerHTML = list.map(r => `
            <tr>
                <td>${r.id}</td>
                <td>${r.name}</td>
                <td>${r.owner_username || '\u2014'}</td>
                <td><span class="status-badge status-badge--${r.status || 'approved'}">${(r.status || 'approved').charAt(0).toUpperCase() + (r.status || 'approved').slice(1)}</span></td>
                <td>${r.image ? '<img src="' + r.image + '" class="table-banner-thumb" alt="Restaurant banner">' : '\u2014'}</td>
                <td class="gap-row">
                    <button class="btn btn-sm btn-primary" onclick="adminEditRestaurant(${r.id}, '${r.name.replace(/'/g,"\\'")}', '${(r.owner_username || '').replace(/'/g,"\\'")}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="adminDeleteRestaurant(${r.id})">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) { console.error(err); }
}

window.adminEditRestaurant = (id, name, ownerUsername) => {
    PandaPopup.open($('#edit-restaurant-card'));
    $('#edit-rest-id').value = id;
    $('#edit-rest-name').value = name;
    $('#edit-rest-owner-username').value = ownerUsername || '';
};

window.adminDeleteRestaurant = async (id) => {
    if (!confirm('Delete restaurant #' + id + '?')) return;
    try {
        const res = await fetch(API + '/restaurants/' + id, { method: 'DELETE', headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);
        showMsg('Restaurant deleted.', 'success');
        adminLoadRestaurants();
        adminRefreshRestaurantSelects();
    } catch (err) { showMsg('Delete failed.'); }
};

// admin menu items section functions

async function adminLoadItems() {
    try {
        const res = await fetch(API + '/menu-items');
        if (!res.ok) {
            const error = await res.json();
            return showMsg(error.error || 'Failed to load items.');
        }
        const list = await res.json();

        // also load restaurants so we can show restaurant names
        const rRes = await fetch(API + '/restaurants');
        if (!rRes.ok) {
            return showMsg('Failed to load restaurants for display.');
        }
        const rests = await rRes.json();
        const rMap = {};
        rests.forEach(r => rMap[r.id] = r.name);

        const tbody = $('#items-tbody');
        tbody.innerHTML = list.map(i => `
            <tr>
                <td>${i.id}</td>
                <td>${rMap[i.restaurant_id] || i.restaurant_id}</td>
                <td title="${i.name}" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.name}</td>
                <td title="${i.description||''}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.description || '—'}</td>
                <td>${formatPrice(i.price)}</td>
                <td>${i.image ? '<img src="' + i.image + '" class="table-banner-thumb" alt="Item banner">' : '—'}</td>
                <td class="gap-row">
                    <button class="btn btn-sm btn-primary" onclick="adminEditItem(${i.id}, ${i.restaurant_id}, '${i.name.replace(/'/g,"\\'")}', ${i.price}, '${(i.description||'').replace(/'/g,"\\'")}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="adminDeleteItem(${i.id})">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) { console.error(err); }
}

window.adminEditItem = (id, restId, name, price, desc) => {
    PandaPopup.open($('#edit-item-card'));
    $('#edit-item-id').value = id;
    $('#edit-item-restaurant').value = restId;
    $('#edit-item-name').value = name;
    $('#edit-item-description').value = desc || '';
    $('#edit-item-price').value = price;
};

window.adminDeleteItem = async (id) => {
    if (!confirm('Delete item #' + id + '?')) return;
    try {
        const res = await fetch(API + '/menu-items/' + id, { method: 'DELETE', headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);
        showMsg('Item deleted.', 'success');
        adminLoadItems();
    } catch (err) { showMsg('Delete failed.'); }
};

async function adminRefreshRestaurantSelects() {
    try {
        const res = await fetch(API + '/restaurants');
        const list = await res.json();
        const opts = '<option value="">Select restaurant…</option>' +
            list.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

        const sel1 = $('#item-restaurant');
        const sel2 = $('#edit-item-restaurant');
        if (sel1) sel1.innerHTML = opts;
        if (sel2) sel2.innerHTML = opts;
    } catch (err) { console.error(err); }
}

async function adminRefreshVendorSelects() {
    try {
        const res = await fetch(API + '/users', { headers: authHeaders() });
        if (!res.ok) return;
        const users = await res.json();
        const owners = users.filter(user => user.role === 'vendor' || user.role === 'admin');
        const opts = '<option value="">Unassigned</option>' +
            owners.map(user => `<option value="${user.username}">${user.username} (${user.role})${user.full_name ? ' — ' + user.full_name : ''}</option>`).join('');

        const addSelect = $('#rest-owner-username');
        const editSelect = $('#edit-rest-owner-username');
        if (addSelect) addSelect.innerHTML = opts;
        if (editSelect) editSelect.innerHTML = opts;
    } catch (err) { console.error(err); }
}

// admin orders section functions

async function adminLoadOrders() {
    try {
        const res = await fetch(API + '/orders', { headers: authHeaders() });
        if (!res.ok) {
            const error = await res.json();
            return showMsg(error.error || 'Failed to load orders.');
        }
        const orders = await res.json();

        const tbody = $('#orders-tbody');
        if (!orders.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No orders yet.</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(o => `
            <tr>
                <td>${o.id}</td>
                <td>${o.customer_name}</td>
                <td>${o.delivery_person || '—'}</td>
                <td><span class="${badgeCls(o.status)}">${formatStatus(o.status)}</span></td>
                <td>${o.delivery_address || '—'}</td>
                <td>
                    <select class="form-control admin-order-status-select" style="width:auto;font-size:.8rem;" onchange="adminUpdateOrderStatus(${o.id}, this.value)">
                        <option value="">Change…</option>
                        <option value="pending">Pending</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="preparing">Preparing</option>
                        <option value="out_for_delivery">Out for Delivery</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </td>
            </tr>
        `).join('');

    } catch (err) { console.error(err); }
}

window.adminUpdateOrderStatus = async (id, status) => {
    if (!status) return;
    try {
        const res = await fetch(API + '/orders/' + id + '/status', {
            method: 'PUT',
            headers: authJSON(),
            body: JSON.stringify({ status })
        });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);
        showMsg('Order #' + id + ' → ' + formatStatus(status), 'success');
        adminLoadOrders();
        adminPopulateStats();
    } catch (err) { showMsg('Update failed.'); }
};

// admin dashboard stats
async function adminPopulateStats() {
    try {
        // Fetch users count
        const usersRes = await fetch(API + '/users', { headers: authHeaders() });
        if (usersRes.ok) {
            const users = await usersRes.json();
            const usersEl = $('#stat-users');
            if (usersEl) animateCounter(usersEl, users.length);
        }

        // Fetch restaurants count
        const restsRes = await fetch(API + '/restaurants');
        if (restsRes.ok) {
            const rests = await restsRes.json();
            const restsEl = $('#stat-restaurants');
            if (restsEl) animateCounter(restsEl, rests.length);
        }

        // Fetch orders for revenue and count
        const ordersRes = await fetch(API + '/orders', { headers: authHeaders() });
        if (ordersRes.ok) {
            const orders = await ordersRes.json();
            const activeOrders = orders.filter(o => !['delivered', 'cancelled'].includes(o.status));
            const totalRevenue = orders.reduce((sum, o) => {
                // Revenue should count only for restaurants that have an owner assigned.
                if (!o.restaurant_owner_username) return sum;

                // Prefer item-level subtotal sum for correctness.
                const itemSubtotal = Array.isArray(o.items)
                    ? o.items.reduce((s, it) => s + Number(it.subtotal || 0), 0)
                    : 0;

                const orderTotal = itemSubtotal > 0 ? itemSubtotal : Number(o.total_amount || 0);
                return sum + orderTotal;
            }, 0);

            const ordersEl = $('#stat-orders');
            if (ordersEl) animateCounter(ordersEl, activeOrders.length);

            const revenueEl = $('#stat-revenue');
            if (revenueEl) animateCounter(revenueEl, totalRevenue, true);
        }
    } catch (err) {
        console.error('Stats error:', err);
    }
}

// Animated counter
function animateCounter(el, target, isCurrency = false) {
    const duration = 800;
    const steps = 30;
    const stepTime = duration / steps;
    let current = 0;
    const increment = target / steps;

    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        if (isCurrency) {
            el.textContent = formatPrice(current);
        } else {
            el.textContent = Math.round(current).toLocaleString();
        }
    }, stepTime);
}

// ============================================================
// ADMIN: PENDING APPROVALS
// ============================================================

const noImagePlaceholder = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E';

async function adminLoadPendingApprovals() {
    const container = $('#pending-approvals-list');
    const badge = $('#approvals-count-badge');
    if (!container) return;

    try {
        const res = await fetch(API + '/restaurants', { headers: authHeaders() });
        if (!res.ok) return;
        const allRestaurants = await res.json();
        const pending = allRestaurants.filter(r => r.status === 'pending');

        // Update badge count
        if (badge) {
            if (pending.length > 0) {
                badge.textContent = pending.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        if (!pending.length) {
            container.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><p>No pending approvals. All clear!</p></div>';
            return;
        }

        container.innerHTML = pending.map(r => `
            <div class="vendor-rest-card is-pending">
                <img class="card-img" src="${r.image || noImagePlaceholder}" alt="${r.name}" loading="lazy" decoding="async">
                <div class="card-body">
                    <h3>${r.name} <span class="status-badge status-badge--pending">Pending</span></h3>
                    <div class="approval-card-owner">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        Submitted by: <strong>${r.owner_username || '\u2014'}</strong>
                    </div>
                    <p>${r.description || 'No description provided.'}</p>
                    <div class="card-actions">
                        <button class="btn btn-sm btn-approve" onclick="adminApproveRestaurant(${r.id})">\u2713 Approve</button>
                        <button class="btn btn-sm btn-reject" onclick="adminRejectRestaurant(${r.id})">\u2717 Reject</button>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Load pending approvals error:', err);
    }
}

window.adminApproveRestaurant = async (id) => {
    try {
        const res = await fetch(API + '/restaurants/' + id + '/status', {
            method: 'PATCH',
            headers: authJSON(),
            body: JSON.stringify({ status: 'approved' })
        });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);
        showMsg(data.message, 'success');
        adminLoadPendingApprovals();
        adminLoadRestaurants();
        adminPopulateStats();
    } catch (err) { showMsg('Approval failed.'); }
};

window.adminRejectRestaurant = async (id) => {
    if (!confirm('Reject this restaurant?')) return;
    try {
        const res = await fetch(API + '/restaurants/' + id + '/status', {
            method: 'PATCH',
            headers: authJSON(),
            body: JSON.stringify({ status: 'rejected' })
        });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);
        showMsg(data.message, 'success');
        adminLoadPendingApprovals();
        adminLoadRestaurants();
    } catch (err) { showMsg('Rejection failed.'); }
};

// ============================================================
// VENDOR DASHBOARD (vendor.html)
// ============================================================

let _vendorCurrentRestaurantId = null;

function initVendor() {
    if (!getToken() || getRole() !== 'vendor') return window.location.href = 'login.html';

    vendorLoadRestaurants();

    // Add new restaurant form
    const addRestForm = $('#vendor-add-restaurant-form');
    if (addRestForm) addRestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.append('name', $('#vendor-rest-name').value.trim());
        fd.append('description', $('#vendor-rest-desc').value.trim());
        fd.append('address', $('#vendor-rest-address').value.trim());
        fd.append('phone', $('#vendor-rest-phone').value.trim());
        const file = $('#vendor-rest-banner').files[0];
        if (file) fd.append('banner', file);

        try {
            const res = await fetch(API + '/vendor/restaurants', {
                method: 'POST', headers: authHeaders(), body: fd
            });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg(data.message, 'success');
            addRestForm.reset();
            vendorLoadRestaurants();
        } catch (err) { showMsg('Failed to submit restaurant.'); }
    });

    // Back to restaurants button
    const backBtn = $('#vendor-back-to-restaurants');
    if (backBtn) backBtn.addEventListener('click', () => {
        $('#vendor-menu-section').classList.add('hidden');
        $('#vendor-restaurants').classList.remove('hidden');
        $('#vendor-add-restaurant-card').classList.remove('hidden');
        _vendorCurrentRestaurantId = null;
    });

    // Add menu item form
    const addItemForm = $('#vendor-add-item-form');
    if (addItemForm) addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.append('restaurant_id', _vendorCurrentRestaurantId);
        fd.append('name', $('#vendor-item-name').value.trim());
        fd.append('description', $('#vendor-item-desc').value.trim());
        fd.append('price', $('#vendor-item-price').value);
        const file = $('#vendor-item-banner').files[0];
        if (file) fd.append('banner', file);

        try {
            const res = await fetch(API + '/vendor/menu-items', {
                method: 'POST', headers: authHeaders(), body: fd
            });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg(data.message, 'success');
            addItemForm.reset();
            vendorLoadMenuItems(_vendorCurrentRestaurantId);
        } catch (err) { showMsg('Failed to add item.'); }
    });

    // Cancel edit item
    const cancelEdit = $('#vendor-cancel-edit-item');
    if (cancelEdit) cancelEdit.addEventListener('click', () => {
        PandaPopup.close($('#vendor-edit-item-card'));
    });

    // Edit item form
    const editItemForm = $('#vendor-edit-item-form');
    if (editItemForm) editItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#vendor-edit-item-id').value;
        const fd = new FormData();
        fd.append('name', $('#vendor-edit-item-name').value.trim());
        fd.append('description', $('#vendor-edit-item-desc').value.trim());
        fd.append('price', $('#vendor-edit-item-price').value);
        const file = $('#vendor-edit-item-banner').files[0];
        if (file) fd.append('banner', file);

        try {
            const res = await fetch(API + '/vendor/menu-items/' + id, {
                method: 'PUT', headers: authHeaders(), body: fd
            });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg(data.message, 'success');
            PandaPopup.close($('#vendor-edit-item-card'));
            vendorLoadMenuItems(_vendorCurrentRestaurantId);
        } catch (err) { showMsg('Update failed.'); }
    });
}

async function vendorLoadRestaurants() {
    const container = $('#vendor-restaurants');
    if (!container) return;

    try {
        const res = await fetch(API + '/vendor/restaurants', { headers: authHeaders() });
        if (!res.ok) {
            const error = await res.json();
            return showMsg(error.error);
        }
        const list = await res.json();

        if (!list.length) {
            container.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg><p>You don\'t have any restaurants yet.<br>Submit one below to get started!</p></div>';
            return;
        }

        container.innerHTML = list.map(r => {
            const statusClass = r.status === 'pending' ? 'is-pending' : r.status === 'rejected' ? 'is-rejected' : '';
            const statusBadge = '<span class="status-badge status-badge--' + r.status + '">' + r.status.charAt(0).toUpperCase() + r.status.slice(1) + '</span>';

            let actions = '';
            let pendingOverlay = '';

            if (r.status === 'approved') {
                actions = '<button class="btn btn-sm btn-manage" onclick="vendorManageMenu(' + r.id + ', \'' + r.name.replace(/'/g, "\\'") + '\')">Manage Menu \u2192</button>';
            } else if (r.status === 'pending') {
                pendingOverlay = '<div class="vendor-pending-overlay">' +
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                    '<span>Verification pending \u2014 an admin must approve this restaurant before you can manage its menu.</span>' +
                    '</div>';
            } else if (r.status === 'rejected') {
                pendingOverlay = '<div class="vendor-pending-overlay" style="background:linear-gradient(135deg,#FFF5F5,#FEE2E2);border-color:#FECACA;color:#991B1B;">' +
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#DC2626"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
                    '<span>This restaurant was rejected. Please contact support for details.</span>' +
                    '</div>';
            }

            return '<div class="vendor-rest-card ' + statusClass + '">' +
                '<img class="card-img" src="' + (r.image || noImagePlaceholder) + '" alt="' + r.name + '" loading="lazy" decoding="async">' +
                '<div class="card-body">' +
                '<h3>' + r.name + ' ' + statusBadge + '</h3>' +
                '<p>' + (r.description || 'No description.') + '</p>' +
                '<div class="card-actions">' + actions + '</div>' +
                '</div>' +
                pendingOverlay +
                '</div>';
        }).join('');
    } catch (err) {
        console.error('Vendor load restaurants error:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load restaurants.</p></div>';
    }
}

window.vendorManageMenu = (restaurantId, restaurantName) => {
    _vendorCurrentRestaurantId = restaurantId;
    $('#vendor-restaurants').classList.add('hidden');
    $('#vendor-add-restaurant-card').classList.add('hidden');
    $('#vendor-menu-section').classList.remove('hidden');
    $('#vendor-menu-title').textContent = restaurantName + ' \u2014 Menu';
    $('#vendor-item-restaurant-id').value = restaurantId;
    vendorLoadMenuItems(restaurantId);
    vendorLoadReviews(restaurantId);
    initFileUploadPlaceholders();
};

async function vendorLoadMenuItems(restaurantId) {
    const tbody = $('#vendor-items-tbody');
    if (!tbody) return;

    try {
        const res = await fetch(API + '/vendor/menu-items/' + restaurantId, { headers: authHeaders() });
        if (!res.ok) {
            const error = await res.json();
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">' + (error.error || 'Failed to load items.') + '</td></tr>';
            return;
        }
        const items = await res.json();

        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No menu items yet. Add one above!</td></tr>';
            return;
        }

        tbody.innerHTML = items.map(i => `
            <tr>
                <td>${i.id}</td>
                <td title="${i.name}" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.name}</td>
                <td title="${i.description||''}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.description || '\u2014'}</td>
                <td>${formatPrice(i.price)}</td>
                <td>${i.image ? '<img src="' + i.image + '" style="height:40px;border-radius:4px;">' : '\u2014'}</td>
                <td class="gap-row">
                    <button class="btn btn-sm btn-primary" onclick="vendorEditItem(${i.id}, '${i.name.replace(/'/g,"\\'")}', ${i.price}, '${(i.description||'').replace(/'/g,"\\'")}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="vendorDeleteItem(${i.id})">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Vendor load menu items error:', err);
    }
}

window.vendorEditItem = (id, name, price, desc) => {
    PandaPopup.open($('#vendor-edit-item-card'));
    $('#vendor-edit-item-id').value = id;
    $('#vendor-edit-item-name').value = name;
    $('#vendor-edit-item-desc').value = desc || '';
    $('#vendor-edit-item-price').value = price;
};

window.vendorDeleteItem = async (id) => {
    if (!confirm('Delete item #' + id + '?')) return;
    try {
        const res = await fetch(API + '/vendor/menu-items/' + id, { method: 'DELETE', headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);
        showMsg('Item deleted.', 'success');
        vendorLoadMenuItems(_vendorCurrentRestaurantId);
    } catch (err) { showMsg('Delete failed.'); }
};

// ============================================================
//  Activity Log — admin audit trail viewer
// ============================================================

const ACTLOG_ACTION_LABELS = {
    'user.login_success': 'Login',
    'user.login_failed': 'Failed Login',
    'user.registered': 'Registration',
    'user.logout': 'Logout',
    'user.profile_updated': 'Profile Updated',
    'admin.user_edited': 'User Edited',
    'admin.user_deleted': 'User Deleted',
    'order.placed': 'Order Placed',
    'order.status_changed': 'Order Status Changed',
    'restaurant.created': 'Restaurant Created',
    'restaurant.edited': 'Restaurant Edited',
    'restaurant.deleted': 'Restaurant Deleted',
    'restaurant.submitted': 'Restaurant Submitted',
    'restaurant.status_changed': 'Restaurant Approval',
    'restaurant.owner_changed': 'Owner Changed',
    'menu_item.created': 'Item Created',
    'menu_item.edited': 'Item Edited',
    'menu_item.deleted': 'Item Deleted',
    'review.created': 'Review Created',
    'review.edited': 'Review Edited',
    'review.deleted': 'Review Deleted',
    'review.vendor_reply': 'Vendor Reply',
    'review.vendor_reply_removed': 'Reply Removed'
};

const ACTLOG_ACTION_COLORS = {
    'user.login_success': '#22c55e',
    'user.login_failed': '#ef4444',
    'user.registered': '#3b82f6',
    'user.logout': '#94a3b8',
    'user.profile_updated': '#8b5cf6',
    'admin.user_edited': '#f59e0b',
    'admin.user_deleted': '#ef4444',
    'order.placed': '#22c55e',
    'order.status_changed': '#06b6d4',
    'restaurant.created': '#22c55e',
    'restaurant.edited': '#f59e0b',
    'restaurant.deleted': '#ef4444',
    'restaurant.submitted': '#3b82f6',
    'restaurant.status_changed': '#f59e0b',
    'restaurant.owner_changed': '#8b5cf6',
    'menu_item.created': '#22c55e',
    'menu_item.edited': '#f59e0b',
    'menu_item.deleted': '#ef4444',
    'review.created': '#22c55e',
    'review.edited': '#f59e0b',
    'review.deleted': '#ef4444',
    'review.vendor_reply': '#06b6d4',
    'review.vendor_reply_removed': '#94a3b8'
};

let _actlogPage = 1;
let _actlogTotalPages = 1;
let _actlogLiveInterval = null;
let _actlogLoaded = false;

function actlogRelativeTime(isoStr) {
    if (!isoStr) return '\u2014';
    const now = Date.now();
    const then = new Date(isoStr).getTime();
    const diff = Math.max(0, now - then);
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return secs + 's ago';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function actlogFormatDetails(detailsStr) {
    if (!detailsStr) return '\u2014';
    try {
        const obj = typeof detailsStr === 'string' ? JSON.parse(detailsStr) : detailsStr;
        const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined);
        if (!entries.length) return '\u2014';
        return entries.map(([k, v]) => {
            const key = k.replace(/_/g, ' ');
            return `<span class="actlog-detail-chip"><strong>${key}:</strong> ${v}</span>`;
        }).join(' ');
    } catch {
        return String(detailsStr).slice(0, 80);
    }
}

function actlogActionBadge(action) {
    const label = ACTLOG_ACTION_LABELS[action] || action.replace(/[._]/g, ' ');
    const color = ACTLOG_ACTION_COLORS[action] || '#64748b';
    return `<span class="actlog-badge" style="--badge-color:${color}">${label}</span>`;
}

async function adminLoadActivityLog(page) {
    if (page !== undefined) _actlogPage = page;
    const tbody = $('#actlog-tbody');
    if (!tbody) return;

    const action = $('#actlog-filter-action')?.value || '';
    const actor = $('#actlog-filter-actor')?.value.trim() || '';
    const search = $('#actlog-filter-search')?.value.trim() || '';

    let url = API + '/admin/activity-log?page=' + _actlogPage + '&limit=50';
    if (action) url += '&action=' + encodeURIComponent(action);
    if (actor) url += '&actor=' + encodeURIComponent(actor);
    if (search) url += '&search=' + encodeURIComponent(search);

    try {
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Failed to load activity log.</td></tr>';
            return;
        }
        const data = await res.json();
        const { logs, pagination } = data;
        _actlogTotalPages = pagination.totalPages || 1;

        if (!logs.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No activity found.</td></tr>';
        } else {
            tbody.innerHTML = logs.map(log => `
                <tr class="actlog-row">
                    <td class="actlog-time" title="${log.created_at || ''}">${actlogRelativeTime(log.created_at)}</td>
                    <td class="actlog-actor">${log.actor || '<em>system</em>'}</td>
                    <td>${actlogActionBadge(log.action)}</td>
                    <td class="actlog-target">${log.target_id || '\u2014'}</td>
                    <td class="actlog-ip">${log.ip_address || '\u2014'}</td>
                    <td class="actlog-details">${actlogFormatDetails(log.details)}</td>
                </tr>
            `).join('');
        }

        // pagination controls
        const prevBtn = $('#actlog-prev');
        const nextBtn = $('#actlog-next');
        const pageInfo = $('#actlog-page-info');
        if (prevBtn) prevBtn.disabled = _actlogPage <= 1;
        if (nextBtn) nextBtn.disabled = _actlogPage >= _actlogTotalPages;
        if (pageInfo) pageInfo.textContent = `Page ${pagination.page} of ${_actlogTotalPages} \u00B7 ${pagination.total} events`;

    } catch (err) {
        console.error('Activity log load error:', err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Error loading logs.</td></tr>';
    }
}

async function adminLoadActivityLogStats() {
    try {
        const res = await fetch(API + '/admin/activity-log/stats', { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const totalEl = $('#actlog-stat-total');
        const loginsEl = $('#actlog-stat-logins');
        const actionsEl = $('#actlog-stat-actions');
        if (totalEl) totalEl.textContent = data.total_logs.toLocaleString();
        if (loginsEl) loginsEl.textContent = data.logins_today.toLocaleString();
        if (actionsEl) actionsEl.textContent = data.actions_today.toLocaleString();
    } catch (err) {
        console.error('Activity log stats error:', err);
    }
}

function adminInitActivityLog() {
    // Wire up filter buttons
    const applyBtn = $('#actlog-apply-filters');
    const clearBtn = $('#actlog-clear-filters');
    const prevBtn = $('#actlog-prev');
    const nextBtn = $('#actlog-next');
    const liveToggle = $('#actlog-live-toggle');

    if (applyBtn) applyBtn.addEventListener('click', () => { _actlogPage = 1; adminLoadActivityLog(); });
    if (clearBtn) clearBtn.addEventListener('click', () => {
        if ($('#actlog-filter-action')) $('#actlog-filter-action').value = '';
        if ($('#actlog-filter-actor')) $('#actlog-filter-actor').value = '';
        if ($('#actlog-filter-search')) $('#actlog-filter-search').value = '';
        _actlogPage = 1;
        adminLoadActivityLog();
    });
    if (prevBtn) prevBtn.addEventListener('click', () => { if (_actlogPage > 1) adminLoadActivityLog(_actlogPage - 1); });
    if (nextBtn) nextBtn.addEventListener('click', () => { if (_actlogPage < _actlogTotalPages) adminLoadActivityLog(_actlogPage + 1); });

    if (liveToggle) liveToggle.addEventListener('change', () => {
        if (liveToggle.checked) {
            adminLoadActivityLog(1);
            adminLoadActivityLogStats();
            _actlogLiveInterval = setInterval(() => {
                adminLoadActivityLog();
                adminLoadActivityLogStats();
            }, 10000);
        } else {
            if (_actlogLiveInterval) { clearInterval(_actlogLiveInterval); _actlogLiveInterval = null; }
        }
    });

    // Also allow Enter key on filter inputs
    ['actlog-filter-actor', 'actlog-filter-search'].forEach(id => {
        const el = $('#' + id);
        if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') { _actlogPage = 1; adminLoadActivityLog(); } });
    });

    // Lazy load: only fetch when the tab is first activated
    const tabBtns = document.querySelectorAll('.tab-btn[data-tab="tab-activity-log"]');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!_actlogLoaded) {
                _actlogLoaded = true;
                adminLoadActivityLog(1);
                adminLoadActivityLogStats();
            }
        });
    });
}
