// main frontend script file

let API;
if (window.location.protocol === 'file:' || (window.location.hostname.match(/localhost|127\.0\.0\.1|192\.168\./) && window.location.port !== '3000' && window.location.port !== '')) {
    API = `http://${window.location.hostname || 'localhost'}:3000/api`;
} else {
    API = window.location.origin + '/api';
}

// ============================================================
// SCROLL ANIMATION SYSTEM (IntersectionObserver)
// ============================================================

function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                // don't unobserve — one-time trigger
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    document.querySelectorAll('[data-animate], [data-stagger]').forEach(el => {
        observer.observe(el);
    });
}

// ============================================================
// NAVBAR GLASSMORPHISM ON SCROLL
// ============================================================

function initNavbarScroll() {
    const navbar = document.getElementById('main-navbar');
    if (!navbar) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                if (window.scrollY > 20) {
                    navbar.classList.add('scrolled');
                } else {
                    navbar.classList.remove('scrolled');
                }
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });
}

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

    // close on scroll so it never stays half-open while browsing on mobile
    window.addEventListener('scroll', () => {
        if (window.innerWidth <= 768 && links.classList.contains('open')) {
            closeMenu();
        }
    }, { passive: true });

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

// small helper functions

const getToken = () => localStorage.getItem('token');
const getRole  = () => localStorage.getItem('role');
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
    const p = window.location.pathname.split('/').pop() || 'index.html';
    return p;
})();

// app start

document.addEventListener('DOMContentLoaded', () => {
    buildNav();
    initScrollAnimations();
    initNavbarScroll();
    initHamburger();
    initFileUploadPlaceholders();
    initCommonButtonLogic();
    initLazyLoading();

    if (page === 'index.html' || page === '') initHome();
    if (page === 'login.html') initLogin();
    if (page === 'profile.html') initProfile();
    if (page === 'my-orders.html') initMyOrders();
    if (page === 'delivery.html') initDelivery();
    if (page === 'admin.html') initAdmin();

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

function initHome() {
    loadRestaurants();
    loadMenuItems();

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
        popup.classList.remove('hidden');
        overlay.classList.remove('hidden');
        // load map first time popup opens
        if (!mapInstance) setTimeout(initCheckoutMap, 100);
        else setTimeout(() => mapInstance.invalidateSize(), 150);
    }

    function closePopup() {
        popup.classList.add('hidden');
        overlay.classList.add('hidden');
    }

    if (fab) fab.addEventListener('click', openPopup);
    if (overlay) overlay.addEventListener('click', closePopup);
    if (closeBtn) closeBtn.addEventListener('click', closePopup);

    const placeBtn = $('#place-order-btn');
    if (placeBtn) placeBtn.addEventListener('click', placeOrder);
}

// search filter
async function filterMenuBySearch(query) {
    try {
        const res = await fetch(API + '/menu-items');
        const data = await res.json();
        const filtered = data.filter(item => item.name.toLowerCase().includes(query));
        const container = $('#menu-list');
        if (!filtered.length) {
            container.innerHTML = '<div class="empty-state"><p>No items match your search.</p></div>';
            return;
        }
        container.innerHTML = filtered.map(item => `
            <div class="card">
                <img class="card-img" src="${item.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E'}" alt="${item.name}">
                <div class="card-body">
                    <h3>${item.name}</h3>
                    <p class="price">${formatPrice(item.price)}</p>
                    <button class="btn btn-primary btn-sm mt-1" onclick="addToCart(${item.id}, '${item.name.replace(/'/g, "\\'") }', ${item.price})">Add to Cart</button>
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
        const res = await fetch(API + '/restaurants');
        if (!res.ok) return showMsg('Failed to load restaurants.');
        const data = await res.json();
        const container = $('#restaurant-list');
        if (!data.length) {
            container.innerHTML = '<div class="empty-state"><p>No restaurants available.</p></div>';
            return;
        }
        container.innerHTML = data.map(r => `
            <div class="card" onclick="filterByRestaurant(${r.id})" style="cursor:pointer;">
                <img class="card-img" src="${r.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E'}" alt="${r.name}">
                <div class="card-body">
                    <h3>${r.name}</h3>
                    <p>${r.description || 'Click to view menu'}</p>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

async function loadMenuItems(restaurantId) {
    try {
        let url = API + '/menu-items';
        if (restaurantId) url += '?restaurant_id=' + restaurantId;
        const res = await fetch(url);
        if (!res.ok) return showMsg('Failed to load menu items.');
        const data = await res.json();
        const container = $('#menu-list');
        if (!data.length) {
            container.innerHTML = '<div class="empty-state"><p>No menu items found.</p></div>';
            return;
        }
        container.innerHTML = data.map(item => `
            <div class="card">
                <img class="card-img" src="${item.image || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22225%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22400%22 height=%22225%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2216%22%3ENo Image%3C/text%3E%3C/svg%3E'}" alt="${item.name}">
                <div class="card-body">
                    <h3>${item.name}</h3>
                    <p class="price">${formatPrice(item.price)}</p>
                    <button class="btn btn-primary btn-sm mt-1" onclick="addToCart(${item.id}, '${item.name.replace(/'/g, "\\'")}', ${item.price})">Add to Cart</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

// keep this global because HTML uses inline onclick
window.filterByRestaurant = (id) => loadMenuItems(id);

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

function initCheckoutMap() {
    const mapEl = document.getElementById('map');
    if (!mapEl || typeof L === 'undefined') return;

    mapInstance = L.map('map').setView([23.8103, 90.4125], 13); // default map center = Dhaka
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(mapInstance);

    mapInstance.on('click', (e) => {
        selectedLat = e.latlng.lat;
        selectedLng = e.latlng.lng;
        if ($('#lat')) $('#lat').value = selectedLat;
        if ($('#lng')) $('#lng').value = selectedLng;

        if (mapMarker) mapInstance.removeLayer(mapMarker);
        mapMarker = L.marker([selectedLat, selectedLng]).addTo(mapInstance)
            .bindPopup('Delivery here').openPopup();
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
                else window.location.href = 'index.html';
            }, 600);
        } catch (err) {
            console.error(err);
            showMsg('Registration failed.');
        }
    });
}

// profile page logic (profile.html)

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

function initDelivery() {
    if (!getToken()) return window.location.href = 'login.html';
    window._deliveryMapNeedsInit = true;
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
                    if (e.target.closest('.update-status-btn') || e.target.closest('.order-status-select')) return;
                    showSelectedPendingOrderOnMap(order, cardRoot);
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

function showSelectedPendingOrderOnMap(order, selectedCardEl) {
    const mapWrap = $('#selected-order-map-wrap');
    const mapEl = document.getElementById('selected-order-map');
    if (!mapWrap || !mapEl || typeof L === 'undefined') return;

    const coords = parseDeliveryCoords(order.delivery_address);
    if (!coords) {
        mapWrap.classList.add('hidden');
        return;
    }

    mapWrap.classList.remove('hidden');

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

    selectedOrderMarker = L.marker([coords.lat, coords.lng]).addTo(selectedOrderMap)
        .bindPopup(`Order #${order.id} - ${order.customer_name || 'Customer'}`)
        .openPopup();

    selectedOrderMap.setView([coords.lat, coords.lng], 15);
    setTimeout(() => selectedOrderMap.invalidateSize(), 180);
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

    const orders = window._pendingOrders || [];
    orders.forEach(o => {
        if (o.delivery_address) {
            const parts = o.delivery_address.split(',').map(s => parseFloat(s.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                const m = L.marker([parts[0], parts[1]]).addTo(deliveryMap)
                    .bindPopup(`Order #${o.id} — ${o.customer_name || 'Customer'}`);
                deliveryMarkers.push(m);
            }
        }
    });

    if (deliveryMarkers.length) {
        const group = L.featureGroup(deliveryMarkers);
        deliveryMap.fitBounds(group.getBounds().pad(0.2));
    }

    setTimeout(() => deliveryMap.invalidateSize(), 200);
}

async function updateOrderStatus(orderId, status) {
    if (!status) return showMsg('Select a status first.');
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

// admin page logic (admin.html)

function initAdmin() {
    if (!getToken() || getRole() !== 'admin') return window.location.href = 'login.html';

    adminLoadUsers();
    adminLoadRestaurants();
    adminLoadItems();
    adminLoadOrders();
    adminPopulateStats();

// admin users section functions
    const cancelEditUser = $('#cancel-edit-user');
    if (cancelEditUser) cancelEditUser.addEventListener('click', () => $('#edit-user-card').classList.add('hidden'));

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
            $('#edit-user-card').classList.add('hidden');
            adminLoadUsers();
        } catch (err) { showMsg('Update failed.'); }
    });

// admin restaurants section functions
    const addRestForm = $('#add-restaurant-form');
    if (addRestForm) addRestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.append('name', $('#rest-name').value.trim());
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
    if (cancelEditRest) cancelEditRest.addEventListener('click', () => $('#edit-restaurant-card').classList.add('hidden'));

    const editRestForm = $('#edit-restaurant-form');
    if (editRestForm) editRestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#edit-rest-id').value;
        const fd = new FormData();
        fd.append('name', $('#edit-rest-name').value.trim());
        const file = $('#edit-rest-banner').files[0];
        if (file) fd.append('banner', file);
        try {
            const res = await fetch(API + '/restaurants/' + id, { method: 'PUT', headers: authHeaders(), body: fd });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg('Restaurant updated!', 'success');
            $('#edit-restaurant-card').classList.add('hidden');
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
    if (cancelEditItem) cancelEditItem.addEventListener('click', () => $('#edit-item-card').classList.add('hidden'));

    const editItemForm = $('#edit-item-form');
    if (editItemForm) editItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#edit-item-id').value;
        const fd = new FormData();
        fd.append('restaurant_id', $('#edit-item-restaurant').value);
        fd.append('name', $('#edit-item-name').value.trim());
        fd.append('price', $('#edit-item-price').value);
        const file = $('#edit-item-banner').files[0];
        if (file) fd.append('banner', file);
        try {
            const res = await fetch(API + '/menu-items/' + id, { method: 'PUT', headers: authHeaders(), body: fd });
            const data = await res.json();
            if (!res.ok) return showMsg(data.error);
            showMsg('Item updated!', 'success');
            $('#edit-item-card').classList.add('hidden');
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
                <td>${u.id}</td>
                <td>${u.username}</td>
                <td>${u.email}</td>
                <td><span class="${badgeCls(u.role)}">${u.role}</span></td>
                <td class="gap-row">
                    <button class="btn btn-sm btn-primary" onclick="adminEditUser(${u.id}, '${u.username.replace(/'/g,"\\'") }', '${u.email.replace(/'/g,"\\'") }', '${u.role}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="adminDeleteUser(${u.id})">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) { console.error(err); }
}

window.adminEditUser = (id, username, email, role) => {
    $('#edit-user-card').classList.remove('hidden');
    $('#edit-user-id').value = id;
    $('#edit-user-name').value = username;
    $('#edit-user-email').value = email;
    $('#edit-user-role').value = role;
};

window.adminDeleteUser = async (id) => {
    if (!confirm('Delete user #' + id + '?')) return;
    try {
        const res = await fetch(API + '/users/' + id, { method: 'DELETE', headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) return showMsg(data.error);
        showMsg('User deleted.', 'success');
        adminLoadUsers();
    } catch (err) { showMsg('Delete failed.'); }
};

    // admin restaurants section functions

async function adminLoadRestaurants() {
    try {
        const res = await fetch(API + '/restaurants');
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
                <td>${r.image ? '<img src="' + r.image + '" style="height:40px;border-radius:4px;">' : '—'}</td>
                <td class="gap-row">
                    <button class="btn btn-sm btn-primary" onclick="adminEditRestaurant(${r.id}, '${r.name.replace(/'/g,"\\'")}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="adminDeleteRestaurant(${r.id})">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) { console.error(err); }
}

window.adminEditRestaurant = (id, name) => {
    $('#edit-restaurant-card').classList.remove('hidden');
    $('#edit-rest-id').value = id;
    $('#edit-rest-name').value = name;
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
                <td>${i.name}</td>
                <td>${formatPrice(i.price)}</td>
                <td>${i.image ? '<img src="' + i.image + '" style="height:40px;border-radius:4px;">' : '—'}</td>
                <td class="gap-row">
                    <button class="btn btn-sm btn-primary" onclick="adminEditItem(${i.id}, ${i.restaurant_id}, '${i.name.replace(/'/g,"\\'")}', ${i.price})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="adminDeleteItem(${i.id})">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) { console.error(err); }
}

window.adminEditItem = (id, restId, name, price) => {
    $('#edit-item-card').classList.remove('hidden');
    $('#edit-item-id').value = id;
    $('#edit-item-restaurant').value = restId;
    $('#edit-item-name').value = name;
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
                    <select class="form-control" style="width:auto;display:inline;font-size:.8rem;" onchange="adminUpdateOrderStatus(${o.id}, this.value)">
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
            const totalRevenue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);

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
