// const API_BASE = 'http://127.0.0.1:8000/api/v1';
const API_BASE = 'https://medilink-emergency-services-backend.onrender.com/api/v1';

//Auth helpers for the MediLink API

const Auth = {
    getToken(){ 
        return localStorage.getItem('ml_access'); 
    },
    getRefresh(){ 
        return localStorage.getItem('ml_refresh'); 
    },
    getUser(){ 
        const u = localStorage.getItem('ml_user'); 
        return u ? JSON.parse(u) : null; 
    },
    getRole(){ 
        return Auth.getUser()?.role ?? null; 
    },

    setSession(access, refresh, user) {
        localStorage.setItem('ml_access',  access);
        localStorage.setItem('ml_refresh', refresh);
        if (user) localStorage.setItem('ml_user', JSON.stringify(user));
    },

    updateUser(user) {
        localStorage.setItem('ml_user', JSON.stringify(user));
    },

    clear() {
        ['ml_access', 'ml_refresh', 'ml_user', 'ml_booking_ref', 'ml_booking_id']
            .forEach(k => localStorage.removeItem(k));
    },

    headers() {
        const h = { 'Content-Type': 'application/json' };
        const t = Auth.getToken();
        if (t) h['Authorization'] = `Bearer ${t}`;
        return h;
    },

    isLoggedIn()  { return !!Auth.getToken(); },
    isClient()    { return Auth.getRole() === 'client'; },
    isDriver()    { return Auth.getRole() === 'driver'; },
    isProvider()  { return Auth.getRole() === 'provider_admin'; },
    isStaff()     { return ['staff', 'admin'].includes(Auth.getRole()) || Auth.getUser()?.is_staff; },
};

// ── Low-level fetch + auto token-refresh ─────────────────────────────────────

async function apiCall(method, path, body = null, isRetry = false) {
    const opts = {
        method,
        headers: Auth.headers(),
        body: body ? JSON.stringify(body) : null,
    };
    const res  = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));

    // Auto-refresh expired access token once
    if (res.status === 401 && !isRetry && Auth.getRefresh()) {
        try {
            const refreshRes  = await fetch(`${API_BASE}/auth/token/refresh/`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ refresh: Auth.getRefresh() }),
            });
            const refreshData = await refreshRes.json();
            if (refreshData.access) {
                localStorage.setItem('ml_access', refreshData.access);
                return apiCall(method, path, body, true); // retry once
            }
        } catch (_) {}
        // Refresh failed — force logout
        Auth.clear();
        window.location.href = '/auth/login.html';
        return;
    }

    if (!res.ok) throw { status: res.status, data };
    return data;
}

// ── Auth API ──────────────────────────────────────────────────────────────────

const AuthAPI = {
    // Registration — three separate endpoints per role
    async registerClient(payload) {
        return apiCall('POST', '/auth/register/client/', payload);
    },
    async registerDriver(payload) {
        return apiCall('POST', '/auth/register/driver/', payload);
    },
    async registerProvider(payload) {
        return apiCall('POST', '/auth/register/provider/', payload);
    },


    // Login — returns { access, refresh, user }
    async login(email, password) {
        const data = await apiCall('POST', '/auth/login/', { email, password });
        Auth.setSession(data.access, data.refresh, data.user);
        return data;
    },

    // Logout — blacklists refresh token on server
    async logout() {
        try {
            await apiCall('POST', '/auth/logout/', { refresh: Auth.getRefresh() });
        } catch (_) {}
        Auth.clear();
        window.location.href = '/index.html';
    },

    // Current user
    async me() {
        const user = await apiCall('GET', '/auth/me/');
        Auth.updateUser(user);
        return user;
    },
    async updateMe(payload) {
        const user = await apiCall('PATCH', '/auth/me/', payload);
        Auth.updateUser(user);
        return user;
    },

    // Profile (role-specific fields)
    async getProfile() {
        return apiCall('GET', '/auth/profile/');
    },
    async updateProfile(payload) {
        // Profile may include file uploads — use FormData for Cloudinary fields
        const hasFile = Object.values(payload).some(v => v instanceof File);
        if (hasFile) {
            const form = new FormData();
            Object.entries(payload).forEach(([k, v]) => { if (v != null) form.append(k, v); });
            const token = Auth.getToken();
            const res   = await fetch(`${API_BASE}/auth/profile/`, {
                method:  'PATCH',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                body:    form,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw { status: res.status, data };
            return data;
        }
        return apiCall('PATCH', '/auth/profile/', payload);
    },

    // Password
    async changePassword(currentPassword, newPassword) {
        return apiCall('POST', '/auth/change-password/', {
            current_password: currentPassword,
            new_password:     newPassword,
        });
    },
    async requestPasswordReset(email) {
        return apiCall('POST', '/auth/password-reset/', { email });
    },
    async confirmPasswordReset(token, otp, newPassword) {
        return apiCall('POST', '/auth/password-reset/confirm/', {
            token,
            otp,
            new_password: newPassword,
        });
    },

    // Token refresh (manual call, usually handled automatically)
    async refreshToken() {
        const data = await apiCall('POST', '/auth/token/refresh/', { refresh: Auth.getRefresh() });
        localStorage.setItem('ml_access', data.access);
        return data;
    },

    // Role upgrades
    async upgradeToDriver(payload = {}) {
        return apiCall('POST', '/auth/upgrade/driver/', payload);
    },
    async upgradeToProvider(payload = {}) {
        return apiCall('POST', '/auth/upgrade/provider/', payload);
    },

    // Admin
    async listUsers(filters = {}) {
        const q = new URLSearchParams(filters).toString();
        return apiCall('GET', `/auth/admin/users/${q ? '?' + q : ''}`);
    },
    async getUser(id) {
        return apiCall('GET', `/auth/admin/users/${id}/`);
    },
    async updateUser(id, payload) {
        return apiCall('PATCH', `/auth/admin/users/${id}/`, payload);
    },
    async verifyUser(id) {
        return apiCall('POST', `/auth/admin/users/${id}/verify/`);
    },
};

// ── Hospitals API ─────────────────────────────────────────────────────────────

const HospitalsAPI = {
    async list(filters = {}) {
        const q = new URLSearchParams(filters).toString();
        return apiCall('GET', `http://localhost:8000/api/v1/hospitals/${q ? '?' + q : ''}`);
    },
    async detail(id) {
        return apiCall('GET', `/hospitals/${id}/`);
    },
    async forEmergency(emergencyType) {
        return apiCall('GET', `/hospitals/for-emergency/?emergency_type=${emergencyType}`);
    },
    async districts() {
        return apiCall('GET', '/hospitals/districts/');
    },
    async submitReview(hospitalId, bookingId, rating, comment = '') {
        return apiCall('POST', `/hospitals/${hospitalId}/reviews/`, {
            booking_id: bookingId, rating, comment,
        });
    },
};

// ── Ambulances API ────────────────────────────────────────────────────────────

const AmbulancesAPI = {
    async list(filters = {}) {
        const q = new URLSearchParams(filters).toString();
        return apiCall('GET', `/ambulances/${q ? '?' + q : ''}`);
    },
    async available(filters = {}) {
        const q = new URLSearchParams(filters).toString();
        return apiCall('GET', `/ambulances/available/${q ? '?' + q : ''}`);
    },
    async detail(id) {
        return apiCall('GET', `/ambulances/${id}/`);
    },
    async providers(filters = {}) {
        const q = new URLSearchParams(filters).toString();
        return apiCall('GET', `/providers/${q ? '?' + q : ''}`);
    },
    // Driver: update own ambulance location
    async updateLocation(ambulanceId, latitude, longitude) {
        return apiCall('PATCH', `/ambulances/${ambulanceId}/location/`, { latitude, longitude });
    },
    // Driver: update own ambulance status
    async updateStatus(ambulanceId, newStatus) {
        return apiCall('PATCH', `/ambulances/${ambulanceId}/status/`, { status: newStatus });
    },
    // Assemble dashboard stats from live endpoints
    async dashboardData() {
        const [bookings, ambulances] = await Promise.all([
            apiCall('GET', '/bookings/'),
            apiCall('GET', '/ambulances/'),
        ]);
        const bookingList   = bookings.results   ?? bookings;
        const ambulanceList = ambulances.results  ?? ambulances;
        const today = new Date().toDateString();
        return {
            dispatches_today: bookingList.filter(b =>
                b.status === 'dispatched' &&
                new Date(b.created_at).toDateString() === today
            ).length,
            fleet_total:     ambulanceList.length,
            fleet_available: ambulanceList.filter(a => a.status === 'available').length,
            recent_bookings: bookingList.slice(0, 10),
        };
    },
};

// ── Bookings API ──────────────────────────────────────────────────────────────

const BookingsAPI = {
    async create(payload) {
        return apiCall('POST', '/bookings/', payload);
    },
    async get(id) {
        return apiCall('GET', `/bookings/${id}/`);
    },
    async list() {
        return apiCall('GET', '/bookings/');
    },
    async active() {
        return apiCall('GET', '/bookings/active/');
    },
    async history() {
        return apiCall('GET', '/bookings/history/');
    },
    // Look up by human-readable reference (e.g. ML-0042)
    async track(reference) {
        const data = await apiCall('GET', `/bookings/?reference=${reference}`);
        const list = data.results ?? data;
        if (Array.isArray(list) && list.length) return list[0];
        // Fallback: scan full list
        const all     = await apiCall('GET', '/bookings/');
        const allList = all.results ?? all;
        return allList.find(b => b.reference === reference) ?? null;
    },
    async cancel(id, reason = '') {
        return apiCall('POST', `/bookings/${id}/cancel/`, { reason });
    },
    // Staff/operator: transition status
    async transition(id, newStatus, note = '') {
        return apiCall('POST', `/bookings/${id}/transition/`, { status: newStatus, note });
    },
    async logs(id) {
        return apiCall('GET', `/bookings/${id}/logs/`);
    },
};


/** SEARCH PAGE */
async function initSearchPage() {
    const grid = document.querySelector('.results-grid');
    const meta = document.querySelector('.results-meta');

    async function loadAmbulances(typeFilter = '') {
        try {
            const filters = typeFilter ? { type: typeFilter } : {};
            const res     = await AmbulancesAPI.list(filters);
            const items   = res.results ?? res;

            if (meta) meta.innerHTML =
                `<span>Showing <strong>${items.length}</strong> ambulances near <strong>Kampala</strong></span>
                 <span>Sorted by: Distance</span>`;

            if (!grid) return;
            grid.innerHTML = items.map(a => {
                const available = a.status === 'available';
                return `
                <div class="provider-card" data-id="${a.id}">
                    <div class="card-top">
                        <div class="provider-icon">🚑</div>
                        <div class="availability ${available ? 'available' : 'busy'}">
                            <span class="${available ? 'status-dot' : 'busy-dot'}"></span>
                            ${available ? 'Available' : 'Busy'}
                        </div>
                    </div>
                    <div class="provider-name">${a.provider.name}</div>
                    <div class="provider-location">📍 ${a.provider.district}</div>
                    <div class="card-tags">
                        <span class="tag">${a.type_display}</span>
                        ${a.provider.is_verified ? '<span class="tag">✓ Verified</span>' : ''}
                    </div>
                    <div class="card-footer">
                        <div>
                            <div class="price">UGX ${(a.base_fare / 1000).toFixed(0)}k</div>
                            <div class="price-label">Base fare</div>
                        </div>
                        <div class="rating">
                            <span class="stars">★</span> ${a.provider.rating ?? '—'}
                        </div>
                    </div>
                </div>`;
            }).join('');

            document.querySelectorAll('.provider-card').forEach(card => {
                card.style.cursor = 'pointer';
                card.addEventListener('click', () => {
                    window.location.href = `../booking/booking.html?ambulance=${card.dataset.id}`;
                });
            });
        } catch (e) {
            console.warn('API unavailable, showing static data', e);
        }
    }

    await loadAmbulances();

    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', function () {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            const typeMap = {
                'Basic Life Support (BLS)':    'BLS',
                'Advanced Life Support (ALS)': 'ALS',
                'ICU-Equipped':                'ICU',
                'Maternity':                   'MAT',
            };
            loadAmbulances(typeMap[this.textContent.trim()] || '');
        });
    });
}

/** BOOKING PAGE */
async function initBookingPage() {
    // Require login to book
    if (!Auth.isLoggedIn()) {
        window.location.href = `/auth/login.html?next=${encodeURIComponent(window.location.href)}`;
        return;
    }

    const params      = new URLSearchParams(window.location.search);
    const ambulanceId = params.get('ambulance');
    const emergencyHint = params.get('emergency_type') || '';

    // Populate hospitals dropdown — suggest based on emergency type if known
    try {
        const hospitalRes = emergencyHint
            ? await HospitalsAPI.forEmergency(emergencyHint)
            : await HospitalsAPI.list({ accepting: 'true' });
        const hospitals   = hospitalRes.results ?? hospitalRes;
        const sel = document.querySelectorAll('select.form-input')[1];
        if (sel && hospitals.length) {
            sel.innerHTML =
                '<option value="">— Select a hospital (optional) —</option>' +
                hospitals.map(h =>
                    `<option value="${h.id}">${h.name} · ${h.available_beds} beds · ${h.district}</option>`
                ).join('');
        }
    } catch (_) {}

    // Populate ambulance dropdown
    try {
        const res  = await AmbulancesAPI.available();
        const ambs = res.results ?? res;
        const sel  = document.querySelectorAll('select.form-input')[2];
        if (sel && ambs.length) {
            sel.innerHTML = ambs.map(a =>
                `<option value="${a.id}" ${a.id === ambulanceId ? 'selected' : ''}>
                    ${a.provider.name} — ${a.type_display} (UGX ${(a.base_fare / 1000).toFixed(0)}k)
                </option>`
            ).join('');

            sel.addEventListener('change', () => {
                const chosen = ambs.find(a => a.id === sel.value);
                if (chosen) updateSummary(chosen);
            });
            const initial = ambs.find(a => a.id === ambulanceId) || ambs[0];
            if (initial) updateSummary(initial);
        }
    } catch (_) {}

    function updateSummary(amb) {
        const name = document.querySelector('.summary-provider-name');
        const type = document.querySelector('.summary-provider-type');
        const base = document.querySelectorAll('.summary-val')[4];
        const tot  = document.querySelector('.total-val');
        if (name) name.textContent = amb.provider.name;
        if (type) type.textContent = `${amb.type_display} · ${amb.provider.district}`;
        if (base) base.textContent = `UGX ${amb.base_fare.toLocaleString()}`;
        if (tot)  tot.textContent  = `UGX ${(amb.base_fare + 5000).toLocaleString()}`;
    }

    const btn = document.querySelector('.btn-submit');
    if (btn) {
        btn.addEventListener('click', async () => {
            const patientName  = document.querySelectorAll('input.form-input')[0]?.value?.trim();
            const patientPhone = document.querySelectorAll('input.form-input')[1]?.value?.trim();
            const emergencyVal = document.querySelectorAll('select.form-input')[0]?.value;
            const pickupAddr   = document.querySelectorAll('input.form-input')[2]?.value?.trim();
            const hospitalId   = document.querySelectorAll('select.form-input')[1]?.value || null;
            const ambulanceId2 = document.querySelectorAll('select.form-input')[2]?.value || null;
            const notes        = document.querySelector('textarea.form-input')?.value || '';

            if (!patientName || !patientPhone || !pickupAddr) {
                alert('Please fill in patient name, phone and pickup location.');
                return;
            }

            const emergencyMap = {
                'Accident / Trauma': 'accident',
                'Cardiac Emergency': 'cardiac',
                'Maternity':         'maternity',
                'Respiratory':       'respiratory',
                'Stroke':            'stroke',
                'Paediatric':        'paediatric',
                'Other':             'other',
            };

            btn.textContent = '⏳ Dispatching...';
            btn.disabled    = true;

            try {
                const booking = await BookingsAPI.create({
                    patient_name:   patientName,
                    patient_phone:  patientPhone,
                    emergency_type: emergencyMap[emergencyVal] || 'other',
                    pickup_address: pickupAddr,
                    hospital:       hospitalId,
                    notes,
                    payment_method: 'cash',
                });

                localStorage.setItem('ml_booking_ref', booking.reference);
                localStorage.setItem('ml_booking_id',  booking.id);
                alert(`✅ Booking submitted! Reference: ${booking.reference}`);
                window.location.href = `../tracking/tracking.html?ref=${booking.reference}&id=${booking.id}`;
            } catch (err) {
                const msg = err?.data?.detail
                    || Object.values(err?.data ?? {}).flat()[0]
                    || 'Please try again or call 999.';
                alert(`Booking failed: ${msg}`);
                btn.textContent = '🚑 Confirm & Dispatch Ambulance';
                btn.disabled    = false;
            }
        });
    }
}

/** TRACKING PAGE */
async function initTrackingPage() {
    const params = new URLSearchParams(window.location.search);
    const id     = params.get('id')  || localStorage.getItem('ml_booking_id');
    const ref    = params.get('ref') || localStorage.getItem('ml_booking_ref');
    if (!id && !ref) return;

    async function refresh() {
        try {
            const booking = id
                ? await BookingsAPI.get(id)
                : await BookingsAPI.track(ref);
            if (!booking) return;

            document.querySelectorAll('[data-booking-ref]').forEach(el => el.textContent = booking.reference);
            document.querySelectorAll('[data-booking-status]').forEach(el => el.textContent = booking.status_display);
            document.querySelectorAll('[data-booking-provider]').forEach(el => el.textContent = booking.ambulance?.provider?.name ?? '—');
            document.querySelectorAll('[data-booking-eta]').forEach(el =>
                el.textContent = booking.status === 'dispatched' ? '~8 min' : booking.status_display
            );
            document.querySelectorAll('[data-booking-patient]').forEach(el => el.textContent = booking.patient_name);
            document.querySelectorAll('[data-booking-hospital]').forEach(el => el.textContent = booking.hospital?.name ?? '—');
        } catch (_) {}
    }

    await refresh();
    setInterval(refresh, 10000);
}

/** DASHBOARD PAGE */
async function initDashboardPage() {
    if (!Auth.isLoggedIn()) {
        window.location.href = '/auth/login.html';
        return;
    }

    try {
        const dash = await AmbulancesAPI.dashboardData();

        const statNums = document.querySelectorAll('.dash-stat-num');
        if (statNums[0]) statNums[0].textContent = dash.dispatches_today;
        if (statNums[2]) statNums[2].innerHTML =
            `${dash.fleet_available}<span style="font-size:16px;color:var(--text-muted);font-weight:400;">/${dash.fleet_total}</span>`;

        const tbody = document.querySelector('tbody');
        if (tbody && dash.recent_bookings?.length) {
            tbody.innerHTML = dash.recent_bookings.map(b => `
                <tr data-booking-id="${b.id}" style="cursor:pointer">
                    <td><code>${b.reference}</code></td>
                    <td>${b.patient_name}</td>
                    <td>${b.pickup_address?.slice(0, 20) || '—'}</td>
                    <td>${b.hospital?.name ?? '—'}</td>
                    <td><span class="status-badge ${b.status}">${b.status_display}</span></td>
                </tr>`).join('');

            tbody.querySelectorAll('tr').forEach(row => {
                row.addEventListener('click', () => {
                    window.location.href = `../tracking/tracking.html?id=${row.dataset.bookingId}`;
                });
            });
        }
    } catch (e) {
        console.warn('Dashboard API unavailable, showing static data', e);
    }
}

/** LOGIN PAGE */
async function initLoginPage() {
    if (Auth.isLoggedIn()) {
        window.location.href = '/index.html';
        return;
    }

    const form = document.querySelector('form') || document.querySelector('.login-form');
    const btn  = document.querySelector('[type="submit"], .btn-login, .btn-submit');

    if (btn) {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const email    = document.querySelector('[name="email"], input[type="email"]')?.value?.trim();
            const password = document.querySelector('[name="password"], input[type="password"]')?.value;

            if (!email || !password) {
                _showError('Please enter your email and password.');
                return;
            }

            btn.disabled    = true;
            btn.textContent = 'Signing in…';

            try {
                const data = await AuthAPI.login(email, password);
                const next = new URLSearchParams(window.location.search).get('next');
                window.location.href = next || '/index.html';
            } catch (err) {
                const msg = err?.data?.detail
                    || err?.data?.non_field_errors?.[0]
                    || 'Login failed. Please check your credentials.';
                _showError(msg);
                btn.disabled    = false;
                btn.textContent = 'Sign In';
            }
        });
    }
}

/** REGISTER PAGE */
async function initRegisterPage() {
    if (Auth.isLoggedIn()) {
        window.location.href = '/index.html';
        return;
    }

    // Role selector chips / tabs
    let selectedRole = 'client';
    document.querySelectorAll('[data-role]').forEach(el => {
        el.addEventListener('click', function () {
            document.querySelectorAll('[data-role]').forEach(r => r.classList.remove('active'));
            this.classList.add('active');
            selectedRole = this.dataset.role;
        });
    });

    const btn = document.querySelector('[type="submit"], .btn-register, .btn-submit');
    if (btn) {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();

            const payload = {
                email:      document.querySelector('[name="email"]')?.value?.trim(),
                first_name: document.querySelector('[name="first_name"]')?.value?.trim(),
                last_name:  document.querySelector('[name="last_name"]')?.value?.trim(),
                password:   document.querySelector('[name="password"]')?.value,
                phone:      document.querySelector('[name="phone"]')?.value?.trim() || undefined,
            };

            if (!payload.email || !payload.first_name || !payload.last_name || !payload.password) {
                _showError('Please fill in all required fields.');
                return;
            }

            btn.disabled    = true;
            btn.textContent = 'Creating account…';

            try {
                const registerFn = {
                    client:   AuthAPI.registerClient,
                    driver:   AuthAPI.registerDriver,
                    provider: AuthAPI.registerProvider,
                }[selectedRole] ?? AuthAPI.registerClient;

                await registerFn(payload);
                // Store email for the verify page
                sessionStorage.setItem('ml_verify_email', payload.email);
                window.location.href = '/auth/verify-email.html';
            } catch (err) {
                const errors = err?.data;
                const msg    = typeof errors === 'object'
                    ? Object.entries(errors).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('\n')
                    : 'Registration failed. Please try again.';
                _showError(msg);
                btn.disabled    = false;
                btn.textContent = 'Create Account';
            }
        });
    }
}

/** VERIFY EMAIL PAGE */
async function initVerifyEmailPage() {
    const email = sessionStorage.getItem('ml_verify_email') || '';
    const emailEl = document.querySelector('[data-verify-email]');
    if (emailEl && email) emailEl.textContent = email;

    const btn = document.querySelector('[type="submit"], .btn-verify, .btn-submit');
    if (btn) {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const token = document.querySelector('[name="token"]')?.value?.trim()
                       || sessionStorage.getItem('ml_verify_token') || '';
            const otp   = document.querySelector('[name="otp"], .otp-input')?.value?.trim()
                       || [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');

            if (!otp || otp.length < 6) {
                _showError('Please enter the 6-digit code from your email.');
                return;
            }

            btn.disabled    = true;
            btn.textContent = 'Verifying…';

            try {
                const data = await AuthAPI.verifyEmail(token, otp);
                sessionStorage.removeItem('ml_verify_email');
                sessionStorage.removeItem('ml_verify_token');
                alert('✅ Email verified! You are now logged in.');
                window.location.href = '/index.html';
            } catch (err) {
                const msg = err?.data?.detail || 'Invalid or expired code. Please try again.';
                _showError(msg);
                btn.disabled    = false;
                btn.textContent = 'Verify Email';
            }
        });
    }

    // Resend link
    const resendBtn = document.querySelector('.btn-resend, [data-action="resend"]');
    if (resendBtn && email) {
        resendBtn.addEventListener('click', async () => {
            try {
                await AuthAPI.resendVerification(email);
                alert('A new verification code has been sent to your email.');
            } catch (_) {}
        });
    }
}

/** PASSWORD RESET PAGE */
async function initPasswordResetPage() {
    const step1 = document.querySelector('[data-step="1"]');
    const step2 = document.querySelector('[data-step="2"]');

    // Step 1 — request OTP
    const step1Btn = document.querySelector('[data-action="request-reset"]');
    if (step1Btn) {
        step1Btn.addEventListener('click', async () => {
            const email = document.querySelector('[name="email"]')?.value?.trim();
            if (!email) { _showError('Please enter your email address.'); return; }

            step1Btn.disabled    = true;
            step1Btn.textContent = 'Sending…';
            try {
                await AuthAPI.requestPasswordReset(email);
                sessionStorage.setItem('ml_reset_email', email);
                if (step1) step1.style.display = 'none';
                if (step2) step2.style.display = '';
            } catch (_) {
                // Show same message either way to prevent email enumeration
                if (step1) step1.style.display = 'none';
                if (step2) step2.style.display = '';
            }
        });
    }

    // Step 2 — confirm OTP + new password
    const step2Btn = document.querySelector('[data-action="confirm-reset"]');
    if (step2Btn) {
        step2Btn.addEventListener('click', async () => {
            const token    = document.querySelector('[name="token"]')?.value?.trim() || '';
            const otp      = document.querySelector('[name="otp"]')?.value?.trim();
            const password = document.querySelector('[name="new_password"]')?.value;

            if (!otp || !password) { _showError('Please fill in all fields.'); return; }

            step2Btn.disabled    = true;
            step2Btn.textContent = 'Resetting…';
            try {
                const data = await AuthAPI.confirmPasswordReset(token, otp, password);
                alert('✅ Password reset successfully. You are now logged in.');
                window.location.href = '/index.html';
            } catch (err) {
                const msg = err?.data?.detail || 'Invalid or expired code.';
                _showError(msg);
                step2Btn.disabled    = false;
                step2Btn.textContent = 'Reset Password';
            }
        });
    }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function _showError(message) {
    let el = document.querySelector('.error-message, .alert-error, #error-msg');
    if (!el) {
        el = document.createElement('div');
        el.className = 'error-message';
        el.style.cssText = 'color:#ef4444;background:#fef2f2;border:1px solid #fecaca;'
            + 'padding:10px 14px;border-radius:8px;margin:10px 0;font-size:14px;white-space:pre-wrap;';
        const form = document.querySelector('form, .form-card, main');
        if (form) form.prepend(el);
    }
    el.textContent = message;
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Auto-initialise ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if      (path.includes('login.html'))        initLoginPage();
    else if (path.includes('register.html'))      initRegisterPage();
    else if (path.includes('verify-email.html'))  initVerifyEmailPage();
    else if (path.includes('password-reset.html'))initPasswordResetPage();
    else if (path.includes('booking.html'))        initBookingPage();
    else if (path.includes('search.html'))         initSearchPage();
    else if (path.includes('tracking.html'))       initTrackingPage();
    else if (path.includes('dashboard.html'))      initDashboardPage();
    else if (path === '/' || path.includes('index.html')) initIndexPage();
});

// ── Global export ─────────────────────────────────────────────────────────────
window.MediLink = { Auth, AuthAPI, HospitalsAPI, AmbulancesAPI, BookingsAPI };