/**
 * TrueFew Social App JavaScript
 * 
 * A comprehensive social media application featuring:
 * - User authentication and profile management
 * - Friend requests and messaging system
 * - Post creation with media attachments
 * - News feed with categorized content
 * - Interest-based user matching
 * - Real-time notifications
 * 
 * Diagnostic note: global error capture inserted early for debugging persistent errors.
 * Remove window.__tfErrorDiagnosticsAdded block when stable.
 * 
 * @author TrueFew Team
 * @version 1.0.0
 */

/* ===========================
   DIAGNOSTIC ERROR CAPTURE (Temporary - early load)
   =========================== */
if (!window.__tfErrorDiagnosticsAdded) {
    window.__tfErrorDiagnosticsAdded = true;
    window.__tfErrors = [];
    function __tfRecord(kind, message, source, lineno, colno, errorObj) {
        const entry = {
            ts: new Date().toISOString(),
            kind,
            message: message || (errorObj && errorObj.message) || 'Unknown',
            source: source || (errorObj && errorObj.fileName) || '',
            line: lineno || (errorObj && errorObj.lineNumber) || null,
            column: colno || (errorObj && errorObj.columnNumber) || null,
            stack: errorObj && errorObj.stack ? errorObj.stack.split('\n').slice(0, 8).join('\n') : null
        };
        window.__tfErrors.push(entry);
        if (window.__tfErrors.length > 25) window.__tfErrors.shift();
        console.warn(`📛 Captured ${kind}:`, entry.message, `@${entry.source}:${entry.line}:${entry.column}`);
    }
    window.addEventListener('error', (e) => __tfRecord('error', e.message, e.filename, e.lineno, e.colno, e.error));
    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason || {};
        __tfRecord('unhandledrejection', r.message || String(r), r.fileName, r.lineNumber, r.columnNumber, r);
    });
    window.showLastErrors = () => { console.table(window.__tfErrors); return window.__tfErrors; };
    window.copyErrors = () => {
        try { navigator.clipboard.writeText(JSON.stringify(window.__tfErrors, null, 2)); console.log('✅ Copied error log'); }
        catch { console.log('Copy failed. Errors:', window.__tfErrors); }
    };
    console.log('🩺 Early diagnostic error capture enabled. Use showLastErrors().');
}

/* ===========================
   EARLY GA NETWORK ERROR SUPPRESSION
   (Prevents initial "Fetch failed loading" noise from google-analytics g/collect before
   initializeAnalytics() applies its later patch. Idempotent + safe.)
   =========================== */
(function earlySuppressGA(){
    if (window.__tfEarlyGASuppression) return;
    window.__tfEarlyGASuppression = true;
    try {
        if (window.fetch) {
            const origFetch = window.fetch;
            window.fetch = function(...args) {
                let url = '';
                try { url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''; } catch {}
                if (url.includes('google-analytics.com/g/collect')) {
                    // Short-circuit GA request completely to avoid network layer errors (esp. with blockers)
                    return Promise.resolve(new Response(null, { status: 204, statusText: 'GA Suppressed (early short-circuit)' }));
                }
                return origFetch.apply(this, args);
            };
        }
        if (navigator && navigator.sendBeacon) {
            const origBeacon = navigator.sendBeacon;
            navigator.sendBeacon = function(url, data) {
                try {
                    if (url && url.includes('google-analytics.com/g/collect')) {
                        // Pretend success without invoking original beacon
                        return true;
                    }
                    return origBeacon.call(this, url, data);    
                } catch (e) {
                    return true; // swallow
                }
            };
        }
        console.log('🛡️ Early GA suppression active');
    } catch (e) {
        console.log('Early GA suppression setup failed (ignored):', e.message || e);
    }
})();

/* ===========================
   GLOBAL VARIABLES
   =========================== */
// Application build/version tag (manually bumped when deploying breaking UI changes)
window.TRUEFEW_VERSION = '1.4.5';

// Current authenticated user object
let currentUser = null;

// Array of all registered users
let users = [];

// Array of all posts in the system
let posts = [];

// Messages organized by conversation ID (format: "userId1_userId2")
let messages = {};

// Track which sidebar modal is currently open
let currentOpenModal = null;

// Per-user news interest subscriptions (was previously referenced before being declared)
// Structure: { [userId: string]: string[] } where array contains interest/category names
// Missing declaration caused ReferenceError inside saveDataToStorage(), aborting post persistence.

// Current page state for navigation tracking
let currentPage = 'landing';

// Temporarily selected interests during registration/editing
let selectedInterests = [];

// Currently attached media for post composition
let attachedMedia = null;

/* ===========================
   URL ROUTING SYSTEM
   =========================== */

/**
 * URL Router for clean URLs
 * Handles routes: /home, /dashboard, /username
 */
class URLRouter {
    constructor() {
        this.setupPopstateListener();
    }

    /**
     * Navigate to a specific route and update URL
     * @param {string} path - The path to navigate to
     * @param {boolean} replace - Whether to replace current history entry
     */
    navigate(path, replace = false) {
        const url = window.location.origin + path;
        if (replace) {
            window.history.replaceState({ path }, '', url);
        } else {
            window.history.pushState({ path }, '', url);
        }
        this.handleRoute(path);
    }

    /**
     * Handle route changes
     * @param {string} path - The current path
     */
    handleRoute(path) {
        console.log('🔄 Router handling path:', path);
        
        // Clean any existing query parameters from the URL
        this.cleanURL();
        
        // Remove leading slash for consistency
        const route = path.startsWith('/') ? path.slice(1) : path;
        
        if (!route || route === 'home') {
            // Landing page
            showLandingPage();
        } else if (route === 'dashboard') {
            // Dashboard page
            if (currentUser) {
                showDashboardPage();
            } else {
                // Redirect to home if not authenticated
                this.navigate('/home', true);
            }
        } else {
            // Assume it's a username route
            const username = route;
            if (currentUser) {
                // Check if it's the current user's profile
                if (username === currentUser.username) {
                    showProfilePage('current');
                } else {
                    // Find user by username and show their profile
                    const user = users.find(u => u.username === username);
                    if (user) {
                        showProfilePage(user.id);
                    } else {
                        // User not found, redirect to dashboard or home
                        this.navigate(currentUser ? '/dashboard' : '/home', true);
                    }
                }
            } else {
                // Redirect to home if not authenticated
                this.navigate('/home', true);
            }
        }
    }

    /**
     * Clean URL by removing query parameters and hash fragments
     */
    cleanURL() {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
    }

    /**
     * Listen for browser back/forward button
     */
    setupPopstateListener() {
        window.addEventListener('popstate', (event) => {
            const path = event.state?.path || window.location.pathname;
            this.handleRoute(path);
        });
    }

    /**
     * Initialize router based on current URL
     */
    init() {
        const currentPath = window.location.pathname;
        this.handleRoute(currentPath);
    }
}

// Create global router instance
const router = new URLRouter();

/* ===========================
   CONSTANTS & CONFIGURATION
   =========================== */

/**
 * Available interests for user selection
 * Used for profile creation, search filtering, and news feed customization
 * @type {string[]}
 */
const availableInterests = [
    'Music', 'Movies', 'Sports', 'Technology', 'Travel', 'Food', 'Art', 'Books',
    'Gaming', 'Fashion', 'Photography', 'Fitness', 'Nature', 'Science', 'History',
    'Cooking', 'Dancing', 'Writing', 'Politics', 'Business', 'Health', 'Education',
    'Animals', 'Cars', 'Architecture', 'Philosophy', 'Psychology', 'Languages',
    'Meditation', 'Yoga', 'Hiking', 'Camping', 'Comedy', 'Theater', 'Crafting',
    'DIY Projects', 'Wine & Spirits', 'Coffee Culture', 'Vintage Collections',
    'Minimalism', 'Sustainability', 'Social Justice', 'Volunteering', 'Networking',
    'Podcasts', 'Streaming', 'Board Games', 'Trivia', 'Karaoke', 'Live Music',
    'Festivals', 'Markets', 'Street Art', 'Urban Exploration', 'Astronomy',
    'Gardening', 'Interior Design', 'Fashion Design', 'Jewelry Making', 'Pottery',
    'Woodworking', 'Metalworking', 'Painting', 'Drawing', 'Sculpture', 'Digital Art',
    'Video Editing', 'Content Creation', 'Social Media', 'Blogging', 'Journalism',
    'Entrepreneurship', 'Investing', 'Real Estate', 'Cryptocurrency', 'Self-Help',
    'Personal Development', 'Life Coaching', 'Spirituality', 'Religious Studies',
    'Cultural Studies', 'Anthropology', 'Sociology', 'Environmental Science'
];

/**
 * News feed data organized by interest categories
 * Each news item contains: title, source, time, url, and summary
 * Used to populate personalized news feeds based on user interests
 * @type {Object.<string, Array.<{title: string, source: string, time: string, url: string, summary: string}>>}
 */
const newsFeeds = {
    'Technology': [
        { title: 'AI Breakthrough in Medical Diagnosis Achieves 98% Accuracy', source: 'Tech Today', time: '2h ago', url: 'https://techcrunch.com/ai-medical-diagnosis', summary: 'Revolutionary AI system can detect early-stage cancer with unprecedented precision, potentially saving millions of lives through early intervention.' },
        { title: 'New Smartphone Features Revealed at Global Tech Conference', source: 'Gadget News', time: '4h ago', url: 'https://arstechnica.com/smartphone-features', summary: 'Latest flagship devices showcase holographic displays, 72-hour battery life, and advanced biometric security features.' },
        { title: 'Quantum Computing Milestone Achieved by Research Team', source: 'Science Tech', time: '6h ago', url: 'https://spectrum.ieee.org/quantum-computing', summary: 'Scientists successfully maintain quantum coherence for record-breaking duration, bringing practical quantum computers closer to reality.' },
        { title: 'Cybersecurity Trends Shaping Enterprise Protection in 2024', source: 'InfoSec Daily', time: '8h ago', url: 'https://infosec.com/trends-2024', summary: 'Zero-trust architecture and quantum encryption emerge as top priorities for protecting against sophisticated cyber threats.' },
        { title: 'Virtual Reality Meets Social Media in New Platform Launch', source: 'Digital Trends', time: '12h ago', url: 'https://digitaltrends.com/vr-social', summary: 'Immersive VR social platform allows users to interact in photorealistic virtual environments, revolutionizing remote collaboration.' }
    ],
    'Music': [
        { title: 'Grammy Nominations Announced with Record Diversity', source: 'Music World', time: '1h ago', url: 'https://grammy.com/nominations-2024', summary: 'This year\'s nominations feature the most diverse lineup in Grammy history, with breakthrough artists from 15 different countries represented.' },
        { title: 'New Album Breaks Streaming Records Within First Hour', source: 'Billboard', time: '3h ago', url: 'https://billboard.com/streaming-records', summary: 'Highly anticipated collaboration album surpasses 50 million streams globally, featuring artists from multiple genres and continents.' },
        { title: 'Vintage Vinyl Sales Surge Despite Digital Music Dominance', source: 'Music Industry', time: '5h ago', url: 'https://musicindustry.com/vinyl-sales', summary: 'Physical vinyl records see 40% increase in sales as collectors and audiophiles embrace the warmth and authenticity of analog sound.' },
        { title: 'AI Composers Creating Chart-Topping Hits Spark Industry Debate', source: 'Future Music', time: '9h ago', url: 'https://futuremusic.com/ai-music', summary: 'Artificial intelligence collaborates with human musicians to create Billboard hits, raising questions about creativity and artistic authenticity.' },
        { title: 'World Music Festival Tour Announces 50-Country Journey', source: 'Live Events', time: '11h ago', url: 'https://liveevents.com/world-tour', summary: 'Massive multi-genre festival tour promotes cultural exchange and sustainable event practices across six continents.' }
    ],
    'Sports': [
        { title: 'Championship Finals Tonight: Epic Showdown Expected', source: 'Sports Center', time: '30m ago', url: 'https://espn.com/championship-finals', summary: 'Two undefeated teams clash in what experts predict will be the most watched championship game in sports history.' },
        { title: 'Rookie Player Breaks 50-Year-Old Records in Debut Season', source: 'ESPN', time: '2h ago', url: 'https://espn.com/rookie-records', summary: 'First-year player surpasses legendary achievements, rewriting record books and inspiring a new generation of athletes.' },
        { title: 'Olympic Preparations Intensify for Paris 2024 Games', source: 'Olympic News', time: '4h ago', url: 'https://olympics.com/preparations', summary: 'Athletes from 206 nations engage in final training phases as new sports debut and sustainability initiatives take center stage.' },
        { title: 'Sports Medicine Technology Predicts Injuries with 95% Accuracy', source: 'Athletic Science', time: '7h ago', url: 'https://athleticscience.com/injury-prediction', summary: 'Revolutionary wearable devices use AI analysis to prevent sports injuries before they occur, extending athlete careers significantly.' },
        { title: 'Youth Sports Participation Reaches All-Time High Globally', source: 'Youth Athletics', time: '10h ago', url: 'https://youthathletics.com/participation', summary: 'Community programs and innovative training methods drive unprecedented engagement in youth sports across all socioeconomic levels.' }
    ],
    'Travel': [
        { title: 'Hidden Gems in Southeast Asia Gaining International Recognition', source: 'Travel Guide', time: '1h ago', url: 'https://lonelyplanet.com/southeast-asia-gems', summary: 'Off-the-beaten-path destinations in Vietnam, Laos, and Myanmar offer authentic cultural experiences away from tourist crowds.' },
        { title: 'Sustainable Tourism Trends Reshape Global Travel Industry', source: 'Eco Travel', time: '3h ago', url: 'https://sustainabletravel.org/trends', summary: 'Carbon-neutral accommodations and community-based tourism become standard as travelers increasingly prioritize environmental impact.' },
        { title: 'Best Winter Destinations for Unique Seasonal Experiences', source: 'Wanderlust', time: '5h ago', url: 'https://wanderlust.com/winter-destinations', summary: 'From Northern Lights viewing in Iceland to hot spring soaking in Japan, winter travel offers once-in-a-lifetime experiences year-round.' },
        { title: 'Digital Nomad Visas Expand to Over 40 Countries Worldwide', source: 'Remote Travel', time: '8h ago', url: 'https://remotetravel.com/nomad-visas', summary: 'Growing number of nations offer specialized visas for remote workers, supporting the booming digital nomad lifestyle movement.' },
        { title: 'Space Tourism Becomes More Accessible with Cost Reductions', source: 'Future Travel', time: '12h ago', url: 'https://futuretravel.com/space-tourism', summary: 'Commercial space flights see 60% price reduction and improved safety protocols, making space travel available to broader audiences.' }
    ],
    'Business': [
        { title: 'Startup Funding Reaches Record $180B in Q4 Investment Surge', source: 'Business Wire', time: '2h ago', url: 'https://businesswire.com/startup-funding', summary: 'Venture capital investments in AI, climate tech, and healthcare startups drive unprecedented funding rounds across global markets.' },
        { title: 'Remote Work Policies Become Permanent at Fortune 500 Companies', source: 'Work Future', time: '5h ago', url: 'https://workfuture.com/remote-policies', summary: 'Major corporations adopt hybrid work models permanently, reshaping commercial real estate markets and urban development patterns.' },
        { title: 'Cryptocurrency Regulation Framework Provides Market Clarity', source: 'Crypto News', time: '8h ago', url: 'https://cryptonews.com/regulation', summary: 'International regulatory standards offer clear guidelines for digital assets while protecting consumer interests and market stability.' }
    ],
    'Health': [
        { title: 'Mental Health Apps Show 60% Improvement in Clinical Outcomes', source: 'Health Tech', time: '3h ago', url: 'https://healthtech.com/mental-health-apps', summary: 'Large-scale studies reveal AI-powered therapy applications significantly reduce anxiety and depression symptoms in users.' },
        { title: 'Plant-Based Diet Benefits Confirmed in Landmark 10-Year Study', source: 'Nutrition Science', time: '6h ago', url: 'https://nutritionscience.com/plant-diet', summary: 'Comprehensive research involving 100,000 participants shows dramatic reduction in heart disease and diabetes risk factors.' },
        { title: 'Gene Therapy Breakthrough Offers Hope for Rare Disease Patients', source: 'Medical Journal', time: '9h ago', url: 'https://medicaljournal.com/gene-therapy', summary: 'Revolutionary treatment successfully treats previously incurable genetic conditions, opening new possibilities for personalized medicine.' }
    ]
};

/**
 * User's followed news sources (stored per user ID)
 * Format: { userId: [interest1, interest2, ...] }
 * @type {Object.<number, string[]>}
 */
let userNewsSubscriptions = {};

/* ===========================
   APPLICATION INITIALIZATION
   =========================== */

/**
 * Initialize the application when DOM is fully loaded
 * Sets up event listeners, loads data, and populates UI elements
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔄 DOMContentLoaded - Page initialization starting');
    console.log('🔄 Initial URL on page load:', window.location.href);
    console.log('🔄 Initial navigation state on page load:', getNavigationState());
    
    try {
        initializeApp();
        loadSampleData();
        setupEventListeners();
        populateInterests();
        console.log('TrueFew Social App: Initialization complete');
    
    // Wait for Firebase to be ready
    if (typeof firebase === 'undefined') {
        console.error('Firebase not loaded! Check your internet connection and Firebase configuration.');
        return;
    }
    
    // Verify Firebase services are available
    if (!auth || !db) {
        console.error('Firebase services not initialized! Check firebase-config.js');
        return;
    }
    
    console.log('✅ Firebase services ready');
    initializeAnalytics();
    console.log('✅ TrueFew Social App Ready!');
    } catch (error) {
        console.error('TrueFew Social App: Initialization failed:', error);
        showNotification('Application failed to load. Please refresh the page.', 'danger');
    }
});

/**
 * Update navbar for signed-in users
 */
function updateNavbarForSignedInUser() {
    const openSignInBtn = document.getElementById('openSignInBtn');
    const signOutBtn = document.getElementById('signOutBtn');
    const openProfileBtn = document.getElementById('openProfileBtn');
    
    if (openSignInBtn) openSignInBtn.style.display = 'none';
    if (signOutBtn) signOutBtn.style.display = 'block';
    if (openProfileBtn) openProfileBtn.style.display = 'block';
}

/**
 * Update navbar for signed-out users  
 */
function updateNavbarForSignedOutUser() {
    const openSignInBtn = document.getElementById('openSignInBtn');
    const signOutBtn = document.getElementById('signOutBtn');
    const openProfileBtn = document.getElementById('openProfileBtn');
    
    if (openSignInBtn) openSignInBtn.style.display = 'block';
    if (signOutBtn) signOutBtn.style.display = 'none';
    if (openProfileBtn) openProfileBtn.style.display = 'none';
}

/**
 * Hide all page containers
 */
function hideAllPages() {
    const pages = ['landingPage', 'dashboardPage', 'profilePage', 'searchPage'];
    pages.forEach(pageId => {
        const page = document.getElementById(pageId);
        if (page) page.style.display = 'none';
    });
}

/**
 * Show the landing page
 */
function showLanding() {
    hideAllPages();
    const landingPage = document.getElementById('landingPage');
    if (landingPage) {
        landingPage.style.display = 'block';
        currentPage = 'landing';
    }
}

/**
 * Set up event listeners for the application
 */
function setupEventListeners() {
    try {
        // Navigation buttons
        const openSearchBtn = document.getElementById('openSearchBtn');
        const openProfileBtn = document.getElementById('openProfileBtn');
        const openSignInBtn = document.getElementById('openSignInBtn');
        const signOutBtn = document.getElementById('signOutBtn');
        const heroCTA = document.getElementById('heroCTA');
        
        if (openSearchBtn) openSearchBtn.addEventListener('click', () => showSearchModal());
        if (openProfileBtn) openProfileBtn.addEventListener('click', () => showProfile('current'));
        if (openSignInBtn) openSignInBtn.addEventListener('click', () => showSignInModal());
        if (signOutBtn) signOutBtn.addEventListener('click', () => signOut());
        if (heroCTA) heroCTA.addEventListener('click', () => showSignUpModal());
        
        console.log('Event listeners setup complete');
    } catch (error) {
        console.warn('Some event listeners failed to setup:', error);
    }
}

/**
 * Populate interests in sign-up modal
 */
function populateInterests() {
    const grid = document.getElementById('interestsGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    grid.className = 'row g-2 interests-form-section';
    
    availableInterests.forEach((interest, index) => {
        const colDiv = document.createElement('div');
        colDiv.className = 'col-md-6 col-lg-4';
        colDiv.innerHTML = `
            <div class="form-check">
                <input type="checkbox" class="form-check-input" id="interest_${index}" value="${interest}" 
                       onchange="toggleInterest('${interest}')">
                <label class="form-check-label" for="interest_${index}">
                    ${interest}
                </label>
            </div>
        `;
        grid.appendChild(colDiv);
    });
}

/**
 * Toggle interest selection
 */
function toggleInterest(interest) {
    const index = selectedInterests.indexOf(interest);
    if (index > -1) {
        selectedInterests.splice(index, 1);
    } else {
        selectedInterests.push(interest);
    }
    
    // Update UI feedback
    const errorDiv = document.getElementById('interestError');
    const successDiv = document.getElementById('interestSuccess');
    
    if (selectedInterests.length < 8) {
        if (errorDiv) {
            errorDiv.textContent = `Please select ${8 - selectedInterests.length} more interest(s).`;
            errorDiv.style.display = 'block';
        }
        if (successDiv) successDiv.style.display = 'none';
    } else {
        if (errorDiv) errorDiv.style.display = 'none';
        if (successDiv) {
            successDiv.textContent = 'Great! Your interests help us connect you with like-minded people.';
            successDiv.style.display = 'block';
        }
    }
}

/**
 * Show sign-in modal
 */
function showSignInModal() {
    const modal = new bootstrap.Modal(document.getElementById('signInModal'));
    modal.show();
}

/**
 * Show sign-up modal
 */
function showSignUpModal() {
    const modal = new bootstrap.Modal(document.getElementById('signUpModal'));
    modal.show();
}

/**
 * Show search modal
 */
function showSearchModal() {
    const modal = new bootstrap.Modal(document.getElementById('searchModal'));
    modal.show();
}

/**
 * Sign out user
 */
async function signOut() {
    try {
        await auth.signOut();
        currentUser = null;
        localStorage.removeItem('truefew_current_user');
        updateNavbarForSignedOutUser();
        showLanding();
        showNotification('Signed out successfully', 'info');
    } catch (error) {
        console.error('Sign out error:', error);
        showNotification('Error signing out', 'danger');
    }
}

/**
 * Validate password requirements
 */
function validatePassword(password) {
    const minLength = 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    
    return password.length >= minLength && hasUppercase && hasLowercase && hasNumber;
}

/**
 * Update dashboard content for signed-in user
 */
function updateDashboardContent() {
    if (!currentUser) return;
    
    // Update user info in sidebar
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const sidebarUsername = document.getElementById('sidebarUsername');
    const sidebarFullName = document.getElementById('sidebarFullName');
    
    if (sidebarAvatar && currentUser.avatar) {
        sidebarAvatar.src = currentUser.avatar;
    }
    if (sidebarUsername) {
        sidebarUsername.textContent = `@${currentUser.username}`;
    }
    if (sidebarFullName) {
        sidebarFullName.textContent = currentUser.fullName;
    }
    
    updateDashboardCounts();
}

/**
 * Initialize the application core functionality
 * Loads saved data from localStorage and sets up initial state
 */
function initializeApp() {
    console.log('TrueFew Social App: Starting initialization...');
    
    try {
        // Initialize URL router
        router.init();
        
        // Check if there's stored navigation state only on initial page load
        const storedState = getNavigationState();
        console.log('🔄 Stored navigation state during init:', storedState);
        console.log('🔄 Is initial page load:', isInitialPageLoad);
        
        // Don't call showLanding() here - let the router handle initial navigation
        // The router will determine the correct page based on URL
        
        // Don't reset isInitialPageLoad here - let Firebase auth handle it
        
        // Load saved user data from localStorage with error handling
        const savedUsers = localStorage.getItem('truefew_users');
        if (savedUsers) {
            users = JSON.parse(savedUsers);
            console.log(`Loaded ${users.length} users from storage`);
            
            // Migration: Update all seeded users to reliable RandomUser avatars if using old URLs
            const avatarMigrations = [
                { username: 'alexj', newAvatar: 'https://randomuser.me/api/portraits/men/1.jpg' },
                { username: 'sarahc', newAvatar: 'https://randomuser.me/api/portraits/women/2.jpg' },
                { username: 'mikez', newAvatar: 'https://randomuser.me/api/portraits/men/3.jpg' }
            ];
            
            let migrationNeeded = false;
            avatarMigrations.forEach(migration => {
                const user = users.find(u => u.username === migration.username);
                if (user && user.avatar && (user.avatar.includes('unsplash.com') || user.avatar.includes('ui-avatars.com') || user.avatar.includes('uifaces.co') || user.avatar.includes('generated.photos'))) {
                    console.log(`Migrating ${user.fullName} avatar to RandomUser`);
                    user.avatar = migration.newAvatar;
                    migrationNeeded = true;
                }
            });
            
            if (migrationNeeded) {
                localStorage.setItem('truefew_users', JSON.stringify(users));
            }
        }

        // Load saved posts before possibly seeding sample data
        const savedPosts = localStorage.getItem('truefew_posts');
        if (savedPosts) {
            try {
                const parsedPosts = JSON.parse(savedPosts);
                if (Array.isArray(parsedPosts) && parsedPosts.length) {
                    posts = parsedPosts.map(p => ({
                        ...p,
                        // Normalize timestamp back to Date objects if serialized strings
                        timestamp: p.timestamp ? new Date(p.timestamp) : new Date()
                    }));
                    console.log(`Loaded ${posts.length} posts from storage`);
                }
            } catch (e) {
                console.warn('Failed to parse saved posts, clearing corrupt key.', e);
                localStorage.removeItem('truefew_posts');
            }
        }
        
        // Load saved messages with error handling
        const savedMessages = localStorage.getItem('truefew_messages');
        if (savedMessages) {
            messages = JSON.parse(savedMessages);
            console.log('Loaded messages from storage');
        }
        
        // Load news subscriptions with error handling
        const savedNewsSubscriptions = localStorage.getItem('truefew_news_subscriptions');
        if (savedNewsSubscriptions) {
            userNewsSubscriptions = JSON.parse(savedNewsSubscriptions);
            console.log('Loaded news subscriptions from storage');
        }
        
        // Auto-login if user session exists
        const savedCurrentUser = localStorage.getItem('truefew_current_user');
        if (savedCurrentUser) {
            currentUser = JSON.parse(savedCurrentUser);
            // Normalize id for legacy local logic (ensure id exists)
            if (!currentUser.id && currentUser.uid) {
                currentUser.id = currentUser.uid;
            }
            console.log(`Auto-login successful for user: ${currentUser.username}`);
            updateNavbarForSignedInUser();
            
            // Check if we should restore navigation state (only on initial load)
            const storedState = getNavigationState();
            console.log('🔄 Auto-login - checking stored state:', storedState);
            console.log('🔄 Auto-login - isInitialPageLoad:', isInitialPageLoad);
            
            if (isInitialPageLoad && storedState.page && storedState.page !== 'landing') {
                console.log('🔄 Auto-login preserving stored navigation state on initial load');
                // Let Firebase authentication handle the restoration
            } else {
                console.log('🔄 Auto-login showing dashboard');
                showDashboard();
            }
        }
        // Note: Profile button listener is set up in setupEventListeners() with universal handler
        
    } catch (error) {
        console.error('Error during app initialization:', error);
        // Clear potentially corrupted data and restart
        localStorage.removeItem('truefew_current_user');
        showNotification('Error loading saved data. Starting fresh.', 'warning');
    }
}

/**
 * Load sample data for demo purposes
 * Creates demo users and posts if no data exists
 * Only runs if users array is empty to avoid overwriting real data
 */
function loadSampleData() {
    // Only load sample data if no users exist (first time use)
    if (users.length === 0) {
        console.log('Loading sample data for demo...');
        
        // Create demo user accounts with diverse profiles
        users = [
            {
                id: 1,
                fullName: 'Alex Johnson',
                username: 'alexj',
                email: 'alex@example.com',
                password: 'UGFzc3dvcmQxMjM=', // 'Password123' hashed with btoa()
                city: 'San Francisco',
                state: 'California',
                country: 'USA',
                avatar: 'https://randomuser.me/api/portraits/men/1.jpg',
                aboutMe: 'Tech enthusiast and music lover from the Bay Area. Always looking for the next adventure and great conversation!',
                interests: ['Technology', 'Music', 'Travel', 'Photography', 'Gaming', 'Food', 'Movies', 'Sports'],
                friends: [2, 3], // Friend IDs
                friendRequests: [], // Pending friend request IDs
                messages: [2], // User IDs with message threads
                posts: []
            },
            {
                id: 2,
                fullName: 'Sarah Chen',
                username: 'sarahc',
                email: 'sarah@example.com',
                password: 'UGFzc3dvcmQxMjM=', // 'Password123' hashed with btoa()
                city: 'New York',
                state: 'New York',
                country: 'USA',
                avatar: 'https://randomuser.me/api/portraits/women/2.jpg',
                aboutMe: 'Artist and fashion designer living in NYC. Passionate about creating beautiful things and exploring different cultures.',
                interests: ['Art', 'Fashion', 'Music', 'Travel', 'Food', 'Books', 'Photography', 'Dancing'],
                friends: [1], // Friend IDs
                friendRequests: [3], // Pending friend request from Mike
                messages: [1], // Message thread with Alex
                posts: []
            },
            {
                id: 3,
                fullName: 'Mike Rodriguez',
                username: 'mikez',
                email: 'mike@example.com',
                password: 'UGFzc3dvcmQxMjM=', // 'Password123' hashed with btoa()
                city: 'Austin',
                state: 'Texas',
                country: 'USA',
                avatar: 'https://randomuser.me/api/portraits/men/3.jpg',
                aboutMe: 'Fitness coach and sports enthusiast from Austin. Love staying active and helping others reach their goals!',
                interests: ['Sports', 'Fitness', 'Music', 'Cars', 'Technology', 'Gaming', 'Movies', 'Food'],
                friends: [1], // Friend IDs
                friendRequests: [], // No pending requests
                messages: [], // No messages
                posts: []
            }
        ];
        
        // Add sample posts
        posts = [
            {
                id: 1,
                authorId: 1,
                content: 'Just discovered this amazing new AI tool for coding! The future is here 🚀',
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
                likes: ['2', '3'],
                comments: [
                    { authorId: 2, content: 'Wow, sounds interesting! Can you share the link?', timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000) }
                ],
                shares: 0,
                media: null
            },
            {
                id: 2,
                authorId: 2,
                content: 'Beautiful sunset from my art studio today. Nature is the best inspiration! 🎨',
                timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
                likes: ['1', '3'],
                comments: [],
                shares: 1,
                media: {
                    type: 'image',
                    url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=500&h=300&fit=crop'
                }
            },
            {
                id: 3,
                authorId: 3,
                content: 'Great workout session this morning! Who else is keeping up with their fitness goals? 💪',
                timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
                likes: ['1'],
                comments: [
                    { authorId: 1, content: 'Keep it up! I should get back to the gym too.', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000) }
                ],
                shares: 0,
                media: null
            }
        ];
        
        // Only persist sample data if there were no existing posts (avoid overwriting user-created content)
        if (!localStorage.getItem('truefew_posts')) {
            saveDataToStorage();
        }
    }
}

// Ensure there is at least a minimal set of demo posts if posts array is empty
function ensureDemoPosts() {
    try {
        if (posts.length === 0 && users.length > 0) {
            const baseAuthor = users[0];
            posts.push({
                id: 1,
                authorId: baseAuthor.id,
                content: 'Welcome to TrueFew! This is a starter post to get your feed going.',
                timestamp: new Date(),
                likes: [],
                comments: [],
                shares: 0,
                media: null
            });
            saveDataToStorage();
        }
    } catch (e) {
        console.warn('ensureDemoPosts failed:', e);
    }
}

/**
 * Set up all event listeners for the application
 * Binds click handlers, form submissions, and keyboard events
 * Centralizes all DOM event management for better organization
 */
function setupEventListeners() {
    try {
        // Navigation and modal buttons
        const openSearchBtn = document.getElementById('openSearchBtn');
        const openProfileBtn = document.getElementById('openProfileBtn');
        const openSignInBtn = document.getElementById('openSignInBtn');
        const signOutBtn = document.getElementById('signOutBtn');
        const heroCTA = document.getElementById('heroCTA');
        
        // Check if elements exist before adding listeners (prevents errors)
        if (openSearchBtn) openSearchBtn.addEventListener('click', showSearchModal);
        // Use universal profile button handler that routes based on sign-in state
        if (openProfileBtn) openProfileBtn.addEventListener('click', handleProfileButtonClick);
        if (openSignInBtn) openSignInBtn.addEventListener('click', showSignInModal);
        if (signOutBtn) signOutBtn.addEventListener('click', signOut);
        if (heroCTA) heroCTA.addEventListener('click', showSignUpModal);
        
        // Post composition
        const publishPostBtn = document.getElementById('publishPost');
        if (publishPostBtn) publishPostBtn.addEventListener('click', publishPost);
        
        // Edit post character counter
        const editPostContent = document.getElementById('editPostContent');
        if (editPostContent) {
            editPostContent.addEventListener('input', updateEditPostCounter);
        }
        
        // File upload previews
        const postPhoto = document.getElementById('postPhoto');
        const signUpImage = document.getElementById('signUpImage');
        const editPostPhoto = document.getElementById('editPostPhoto');
        if (postPhoto) postPhoto.addEventListener('change', previewPhoto);
        if (signUpImage) signUpImage.addEventListener('change', previewProfileImage);
        if (editPostPhoto) editPostPhoto.addEventListener('change', editPreviewPhoto);
        
        // Form submissions with Enter key support
        document.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                // Determine which modal is open and submit appropriate form
                if (e.target.closest('#signInModal')) {
                    e.preventDefault();
                    submitSignIn();
                } else if (e.target.closest('#signUpModal')) {
                    e.preventDefault();
                    submitSignUp();
                }
            }
        });
        
        // Glassmorphism navbar scroll effect
        window.addEventListener('scroll', function() {
            const navbar = document.querySelector('.glassmorphism-navbar');
            if (navbar) {
                if (window.scrollY > 50) {
                    navbar.classList.add('scrolled');
                } else {
                    navbar.classList.remove('scrolled');
                }
            }
        });
        
        console.log('Event listeners setup complete');
        
    } catch (error) {
        console.error('Error setting up event listeners:', error);
    }
}

/* ===========================
   NAVIGATION FUNCTIONS
   =========================== */

/**
 * Show the landing page
 * Hides all other pages and displays the main hero section
 * Prevents body scrolling for immersive hero experience
 */
function showLanding() {
    router.navigate('/home');
}

function showLandingPage() {
    hideAllPages();
    const landingPage = document.getElementById('landingPage');
    if (landingPage) {
        landingPage.style.display = 'block';
        currentPage = 'landing';
        // Clear navigation state when returning to landing
        setNavigationState('landing');
        // Prevent scrolling on landing page
        document.body.classList.add('landing-page');
    } else {
        console.error('Landing page element not found');
    }
}

/**
 * Show the dashboard page
 * Requires user authentication - redirects to sign-in if not logged in
 * Loads news feed and posts feed after successful authentication
 */
function showDashboard() {
    // Authentication check
    if (!currentUser) {
        showSignInModal();
        return;
    }
    
    router.navigate('/dashboard');
}

function showDashboardPage() {
    hideAllPages();
    
    // Remove landing-page class to show background at 40% opacity
    document.body.classList.remove('landing-page');
    
    const dashboardPage = document.getElementById('dashboardPage');
    if (dashboardPage) {
        dashboardPage.style.display = 'block';
        currentPage = 'dashboard';
        
        // Store navigation state for refresh persistence
        setNavigationState('dashboard');
        
        // Load dashboard content
        try {
            updateDashboardContent();
            // Provide fallback demo posts if none loaded (e.g., sample data skipped)
            ensureDemoPosts();
            loadNewsFeed();
            loadPostsFeed();
        } catch (error) {
            console.error('Error loading dashboard content:', error);
            showNotification('Error loading dashboard. Please refresh.', 'danger');
        }
    } else {
        console.error('Dashboard page element not found');
    }
}

/**
 * Show a user's profile page
 * @param {number|string} userId - User ID or 'current' for logged-in user
 */
function showProfile(userId) {
    console.log('🔄 showProfile called with userId:', userId, 'type:', typeof userId);
    
    // Determine which user to show and get their username for URL
    let user;
    if (userId === 'current') {
        user = currentUser;
    } else {
        // Try to find user by id first (numeric), then by uid (Firebase)
        user = users.find(u => u.id == userId || u.uid === userId);
    }
    
    if (user && user.username) {
        router.navigate('/' + user.username);
    } else {
        console.error('User not found:', userId);
        showNotification('User not found', 'danger');
        // Redirect to dashboard if user not found
        router.navigate('/dashboard');
    }
}

function showProfilePage(userId) {
    console.log('🔄 showProfilePage called with userId:', userId, 'type:', typeof userId);
    console.log('🔄 Current URL before showProfilePage:', window.location.href);
    
    hideAllPages();
    const profilePage = document.getElementById('profilePage');
    if (profilePage) {
        profilePage.style.display = 'block';
        currentPage = 'profile';
        
        // Store navigation state for refresh persistence
        setNavigationState('profile', userId);
        
        // Check URL immediately after setting state
        console.log('🔄 URL after setNavigationState:', window.location.href);
        
        // Determine which user to show
        let user;
        if (userId === 'current') {
            user = currentUser;
        } else {
            // Try to find user by id first (numeric), then by uid (Firebase)
            user = users.find(u => u.id == userId || u.uid === userId);
        }
        
        console.log('🔄 Found user for profile:', user ? user.fullName || user.email : 'Not found');
        
        if (user) {
            populateProfilePage(user);
        } else {
            console.error('User not found:', userId);
            showNotification('User not found', 'danger');
        }
    } else {
        console.error('Profile page element not found');
    }
    
    // Check URL at the very end of showProfilePage
    setTimeout(() => {
        console.log('🔄 Final URL after showProfilePage completion:', window.location.href);
        const finalState = getNavigationState();
        console.log('🔄 Final navigation state after showProfilePage:', finalState);
    }, 10);
}

/**
 * Show demo profile (first sample user)
 * Used for showcasing the application without requiring registration
 */
function showDemo() {
    showProfile(1); // Show first demo user profile
}

/**
 * Hide all page sections
 * Utility function used by navigation to ensure only one page is visible
 * Removes landing-page class to restore normal scrolling
 */
function hideAllPages() {
    try {
        document.querySelectorAll('.page-section').forEach(page => {
            page.style.display = 'none';
        });
        // Remove landing-page class to restore scrolling
        document.body.classList.remove('landing-page');
    } catch (error) {
        console.error('Error hiding pages:', error);
    }
}

// Global flag to prevent navigation state overwrite during restoration
let isRestoringNavigationState = false;
let isInitialPageLoad = true; // Track if this is the first page load

/**
 * Store navigation state in localStorage for refresh persistence
 * Updated to use localStorage instead of URL parameters for clean URLs
 * @param {string} page - The current page ('dashboard', 'profile', etc.)
 * @param {string} userId - Optional user ID for profile views
 */
function setNavigationState(page, userId = null) {
    // Don't overwrite navigation state if we're in the middle of restoring it
    if (isRestoringNavigationState && page === 'landing') {
        console.log('🔄 Blocked navigation state overwrite during restoration');
        return;
    }
    
    try {
        // Log the call stack to see where this is being called from
        const stack = new Error().stack;
        const caller = stack.split('\n')[2];
        console.log('🔄 setNavigationState called:', page, userId, 'from:', caller);
        
        // Store navigation state in localStorage for refresh persistence
        const navigationState = {
            page: page,
            userId: userId,
            timestamp: Date.now()
        };
        
        localStorage.setItem('truefew_navigation_state', JSON.stringify(navigationState));
        console.log('🔄 Navigation state stored:', navigationState);
    } catch (error) {
        console.error('Error setting navigation state:', error);
    }
}

/**
 * Get stored navigation state from localStorage
 * @returns {object} Navigation state with page and userId
 */
function getNavigationState() {
    try {
        const stored = localStorage.getItem('truefew_navigation_state');
        if (stored) {
            const state = JSON.parse(stored);
            console.log('Getting navigation state from localStorage:', state);
            return state;
        }
        return { page: null, userId: null };
    } catch (error) {
        console.error('Error getting navigation state:', error);
        return { page: null, userId: null };
    }
}

/**
 * Restore navigation state after authentication
 * Called when user is authenticated to restore their previous view
 * Now uses router for clean URL navigation
 */
function restoreNavigationState() {
    const state = getNavigationState();
    console.log('🔄 Attempting to restore navigation state:', state);
    
    if (state.page === 'profile' && state.userId) {
        console.log('🔄 Restoring profile view for user:', state.userId);
        
        // Set flag to prevent overwriting during restoration
        isRestoringNavigationState = true;
        
        // Use router to navigate to the appropriate username URL
        let user;
        if (state.userId === 'current') {
            user = currentUser;
        } else {
            user = users.find(u => u.id == state.userId || u.uid === state.userId);
        }
        
        if (user && user.username) {
            router.navigate('/' + user.username, true);
        } else {
            // Fallback to dashboard if user not found
            router.navigate('/dashboard', true);
        }
        
        // Clear flag after a brief delay to allow restoration to complete
        setTimeout(() => {
            isRestoringNavigationState = false;
            console.log('🔄 Navigation state restoration complete');
        }, 100);
        
        return true; // Indicate successful restoration
    } else if (state.page === 'dashboard') {
        console.log('🔄 Restoring dashboard view');
        
        isRestoringNavigationState = true;
        router.navigate('/dashboard', true);
        setTimeout(() => {
            isRestoringNavigationState = false;
        }, 100);
        
        return true; // Indicate successful restoration
    }
    
    console.log('🔄 No valid navigation state to restore');
    return false; // Indicate no restoration happened
}

// Modal Functions
function showSignUpModal() {
    const modal = new bootstrap.Modal(document.getElementById('signUpModal'));
    modal.show();
}

function showSignInModal() {
    const modal = new bootstrap.Modal(document.getElementById('signInModal'));
    modal.show();
}

function showSearchModal() {
    populateInterestDropdown();
    const modal = new bootstrap.Modal(document.getElementById('searchModal'));
    modal.show();
}

function showSignUp() {
    bootstrap.Modal.getInstance(document.getElementById('signInModal')).hide();
    setTimeout(() => showSignUpModal(), 300);
}

// Interest Management
function populateInterests() {
    const grid = document.getElementById('interestsGrid');
    grid.innerHTML = '';
    
    availableInterests.forEach((interest, index) => {
        const colDiv = document.createElement('div');
        colDiv.className = 'col-md-3';
        
        colDiv.innerHTML = `
            <div class="form-check">
                <input type="checkbox" class="form-check-input" id="interest_${index}" value="${interest}" onchange="toggleInterest('${interest}')">
                <label class="form-check-label" for="interest_${index}">
                    ${interest}
                </label>
            </div>
        `;
        
        grid.appendChild(colDiv);
    });
}

function populateInterestDropdown() {
    const select = document.getElementById('searchByInterest');
    select.innerHTML = '<option value="">Select an interest</option>';
    
    availableInterests.forEach(interest => {
        const option = document.createElement('option');
        option.value = interest;
        option.textContent = interest;
        select.appendChild(option);
    });
}

function toggleInterest(interest) {
    const index = selectedInterests.indexOf(interest);
    const errorDiv = document.getElementById('interestError');
    const successDiv = document.getElementById('interestSuccess');
    
    if (index > -1) {
        selectedInterests.splice(index, 1);
    } else {
        selectedInterests.push(interest);
    }
    
    // Update error/success messages
    if (selectedInterests.length < 8) {
        errorDiv.textContent = `Please select ${8 - selectedInterests.length} more interest(s). You can select as many as you like, but at least 8 are required.`;
        errorDiv.style.display = 'block';
        successDiv.style.display = 'none';
    } else {
        errorDiv.style.display = 'none';
        successDiv.textContent = 'Sharing your interests allows us to help connect you with people who share your style.';
        successDiv.style.display = 'block';
    }
}

// ===========================
// Email Verification Utilities
// ===========================
async function resendVerificationEmail() {
    try {
        const user = auth.currentUser;
        if (!user) {
            showNotification('You must be signed in to resend verification.', 'warning');
            return;
        }
        if (user.emailVerified) {
            showNotification('Email already verified.', 'info');
            return;
        }
        await user.sendEmailVerification();
        showNotification('Verification email sent. Check your inbox/spam.', 'success');
    } catch (err) {
        console.error('Resend verification error:', err);
        showNotification(err.message || 'Failed to resend verification email.', 'danger');
    }
}

/**
 * Request verification email for a user (from sign-in modal)
 * Attempts to sign in temporarily to send verification email
 */
async function requestVerificationEmail() {
    try {
        const email = document.getElementById('signInUsername').value.trim();
        const password = document.getElementById('signInPassword').value.trim();
        
        if (!email || !password) {
            showNotification('Please enter your email and password to resend verification.', 'warning');
            return;
        }
        
        // Temporarily sign in to access user object
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        if (user.emailVerified) {
            showNotification('Your email is already verified! You can sign in normally.', 'info');
            await auth.signOut();
            return;
        }
        
        // Send verification email
        await user.sendEmailVerification();
        showNotification(`Verification email sent to ${email}. Please check your inbox and spam folder.`, 'success');
        
        // Sign out immediately
        await auth.signOut();
        
    } catch (error) {
        console.error('Request verification error:', error);
        if (error.code === 'auth/user-not-found') {
            showNotification('No account found with this email address.', 'danger');
        } else if (error.code === 'auth/wrong-password') {
            showNotification('Incorrect password. Please check your password and try again.', 'danger');
        } else if (error.code === 'auth/too-many-requests') {
            showNotification('Too many verification emails sent. Please wait before requesting another.', 'warning');
        } else {
            showNotification(error.message || 'Failed to send verification email.', 'danger');
        }
    }
}

// Authentication Functions
/**
 * Enhanced Sign Up with Firebase Authentication and Email Verification
 * Creates user account, sends verification email, and stores profile in Firestore
 */
async function submitSignUp() {
    try {
        const fullName = document.getElementById('signUpFullName').value.trim();
        const username = document.getElementById('signUpUsername').value.trim();
        const email = document.getElementById('signUpEmail').value.trim();
        const password = document.getElementById('signUpPassword').value;
        const city = document.getElementById('signUpCity').value.trim();
        const state = document.getElementById('signUpState').value.trim();
        const country = document.getElementById('signUpCountry').value.trim();
        const imageFile = document.getElementById('signUpImage').files[0];
        
        // Validation
        if (!fullName || !username || !email || !password || !city || !state || !country) {
            showNotification('Please fill in all required fields.', 'danger');
            return;
        }
        
        if (selectedInterests.length < 8) {
            document.getElementById('interestError').textContent = 'Please select at least 8 interests.';
            document.getElementById('interestError').style.display = 'block';
            return;
        }
        
        if (!validatePassword(password)) {
            showNotification('Password must be at least 8 characters with uppercase, lowercase, and number.', 'danger');
            return;
        }
        
        // Check if username exists in Firestore
        const usernameCheck = await db.collection('users').where('username', '==', username.toLowerCase()).get();
        if (!usernameCheck.empty) {
            showNotification('Username already exists. Please choose another.', 'danger');
            return;
        }
        
        // Create Firebase user
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;

        // Prepare avatar (always store a stable data URL or generated placeholder; never a blob: URL)
        let avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&size=150&background=667eea&color=fff`;
        if (imageFile) {
            try {
                showNotification('Processing profile image...', 'info', 1500);
                
                // Resize image to reduce storage size
                const resizedBlob = await resizeImage(imageFile, 400, 400, 0.8);
                
                avatarUrl = await new Promise((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = e => {
                        const result = e.target.result;
                        // Ensure result is a data URL (starts with data:). If not, fall back to placeholder
                        if (typeof result === 'string' && result.startsWith('data:')) {
                            const sizeKB = (result.length * 0.75 / 1024).toFixed(1); // Rough base64 size estimate
                            tfDebug('Compressed avatar size: ~' + sizeKB + 'KB');
                            resolve(result);
                        } else {
                            console.warn('Avatar file did not produce data URL, using fallback.');
                            resolve(avatarUrl);
                        }
                    };
                    r.onerror = err => reject(err);
                    r.readAsDataURL(resizedBlob);
                });
            } catch (error) {
                console.error('Image processing failed:', error);
                showNotification('Image processing failed. Using default avatar.', 'warning');
                // Keep the default avatarUrl
            }
        }
        // Final guard against accidental blob: or empty string
        if (!avatarUrl || avatarUrl.startsWith('blob:')) {
            console.warn('Replacing invalid avatar URL (blob/empty) with generated placeholder');
            avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&size=150&background=667eea&color=fff`;
        }

        // Send email verification (with action code settings for better UX if desired)
        try {
            await user.sendEmailVerification();
        } catch (verifyErr) {
            console.error('Email verification send failed:', verifyErr);
            showNotification('Could not send verification email. You can request a new one from sign-in screen.', 'warning');
        }

        // Create user profile in Firestore
        await db.collection('users').doc(user.uid).set({
            fullName,
            username: username.toLowerCase(),
            email,
            city,
            state,
            country,
            interests: selectedInterests,
            avatar: avatarUrl,
            aboutMe: '', // Initialize aboutMe field
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            friends: [],
            friendRequests: [],
            messages: []
        });
        
        // Sign out immediately to prevent auto-login before verification
        await auth.signOut();
        
        // Reset form and UI
        selectedInterests = [];
        document.getElementById('signUpForm').reset();
        populateInterests();
        
        // Close modal and show verification message
        bootstrap.Modal.getInstance(document.getElementById('signUpModal')).hide();
        showNotification(`Account created! Please check ${email} for verification link before signing in.`, 'success');
        
    } catch (error) {
        console.error('Sign up error:', error);
        showNotification(error.message, 'danger');
    }
}

/**
 * Enhanced Sign In with Firebase Authentication and Email Verification Check
 * Authenticates user and loads profile from Firestore
 */
async function submitSignIn() {
    try {
        const email = document.getElementById('signInUsername').value.trim();
        const password = document.getElementById('signInPassword').value;
        const errorDiv = document.getElementById('signInError');
        
        if (!email || !password) {
            errorDiv.textContent = 'Please fill in all fields.';
            errorDiv.style.display = 'block';
            return;
        }
        
        // Sign in with Firebase
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // Check if email is verified (with development bypass)
        const isDevelopmentMode = localStorage.getItem('truefew_dev_mode') === 'true';
        
        if (!user.emailVerified && !isDevelopmentMode) {
            console.error('Email verification failed. Tries left decreasing - likely Firebase email service issue.');
            showNotification('Email not verified. Email service may be experiencing issues. Check console for dev bypass.', 'warning');
            
            // Log helpful info for debugging
            console.log('🔧 DEVELOPER TIP: To bypass email verification for testing, run this in console:');
            console.log('localStorage.setItem("truefew_dev_mode", "true"); location.reload();');
            console.log('🔧 To re-enable verification: localStorage.removeItem("truefew_dev_mode"); location.reload();');
            
            try {
                await user.sendEmailVerification();
            } catch (err) {
                console.warn('Resend verification failed or throttled:', err?.message);
                console.error('Firebase email service error - 404 responses detected');
            }
            await auth.signOut();
            return;
        }
        
        // Development mode active notification
        if (isDevelopmentMode && !user.emailVerified) {
            console.warn('⚠️ DEVELOPMENT MODE: Email verification bypassed for testing');
            showNotification('DEV MODE: Email verification bypassed for testing', 'info', 2000);
        }
        
        // Load user profile from Firestore
        const userDoc = await db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            currentUser = { uid: user.uid, ...userDoc.data() };
            // Note: updateNavbarForSignedInUser() will be called automatically by auth state listener
            showDashboard();
            showNotification(`Welcome back, ${currentUser.fullName}!`, 'success');
        } else {
            showNotification('User profile not found. Please contact support.', 'danger');
            await auth.signOut();
            return;
        }
        
        // Clear form and close modal
        document.getElementById('signInForm').reset();
        errorDiv.style.display = 'none';
        bootstrap.Modal.getInstance(document.getElementById('signInModal')).hide();
        
    } catch (error) {
        console.error('Sign in error:', error);
        const errorDiv = document.getElementById('signInError');
        errorDiv.textContent = error.message;
        errorDiv.style.display = 'block';
    }
}

/**
 * Sign out current user with Firebase
 * Clears user session and returns to landing page
 */
async function signOut() {
    try {
        const username = currentUser?.username || 'Unknown';
        
        // Sign out from Firebase
        await auth.signOut();
        
        // Clear local user data
        currentUser = null;
        
        // Clear user-specific navbar data
        const navUserAvatar = document.getElementById('navUserAvatar');
        const navUsername = document.getElementById('navUsername');
        if (navUserAvatar) navUserAvatar.src = '';
        if (navUsername) navUsername.textContent = '';
        
        // Update UI
        updateNavbarForSignedOutUser();
        showLanding();
        
        showNotification('Successfully signed out. See you soon!', 'info');
        console.log('User signed out:', username);
        
    } catch (error) {
        console.error('Error during sign out:', error);
        // Force cleanup even if error occurs
        currentUser = null;
        showLanding();
    }
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {boolean} - True if password meets requirements
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return false;
    }
    
    // Require: 8+ chars, uppercase, lowercase, number
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(password);
}

/**
 * Resend email verification to current user
 * Useful if user didn't receive the initial email
 */
async function resendVerificationEmail() {
    try {
        const user = auth.currentUser;
        if (!user) {
            showNotification('No user signed in. Please sign up first.', 'warning');
            return;
        }
        
        if (user.emailVerified) {
            showNotification('Your email is already verified! You can sign in.', 'success');
            return;
        }
        
        await user.sendEmailVerification();
        showNotification(`Verification email sent to ${user.email}. Please check your inbox and spam folder.`, 'info');
        
    } catch (error) {
        console.error('Error resending verification email:', error);
        showNotification('Error sending verification email. Please try again later.', 'danger');
    }
}

/**
 * Hash password for storage (demo implementation)
 * @param {string} password - Plain text password
 * @returns {string} - Hashed password
 * @note In production, use proper hashing like bcrypt
 */
function hashPassword(password) {
    if (!password || typeof password !== 'string') {
        console.error('Invalid password for hashing');
        return '';
    }
    
    try {
        // Simple base64 encoding for demo - use proper hashing in production
        return btoa(password);
    } catch (error) {
        console.error('Error hashing password:', error);
        return '';
    }
}

// Friend Request Functions
function sendFriendRequest(targetUserId) {
    console.log('Sending friend request to:', targetUserId);
    if (!currentUser) {
        showNotification('Please sign in to send friend requests.', 'info');
        return;
    }
    
    const targetUser = users.find(u => u.id === targetUserId);
    if (!targetUser) {
        alert('User not found.');
        return;
    }
    
    // Initialize arrays if they don't exist
    if (!currentUser.friends) currentUser.friends = [];
    if (!targetUser.friendRequests) targetUser.friendRequests = [];
    
    // Check if already friends
    if (currentUser.friends.includes(targetUserId)) {
        showNotification('You are already friends with this user.', 'info');
        return;
    }
    
    // Check if request already sent
    if (targetUser.friendRequests.includes(currentUser.id)) {
        showNotification('Friend request already sent to this user.', 'info');
        return;
    }
    
    // Send friend request
    targetUser.friendRequests.push(currentUser.id);
    saveDataToStorage();
    
    // Show confirmation
    showNotification('Your friend request has been sent!', 'success');
    
    // Update the button to show request sent
    if (typeof event !== 'undefined' && event && event.target) {
        const addFriendBtn = event.target.closest('button');
        if (addFriendBtn) {
            addFriendBtn.innerHTML = '<i class="bi bi-check"></i> Request Sent';
            addFriendBtn.disabled = true;
            addFriendBtn.className = 'btn btn-success';
        }
    }
}

function acceptFriendRequest(requesterId) {
    console.log('Accepting friend request from:', requesterId);
    if (!currentUser) {
        showNotification('Please sign in first.', 'danger');
        return;
    }
    
    // Add to friends list for both users
    if (!currentUser.friends) currentUser.friends = [];
    currentUser.friends.push(requesterId);
    
    const requester = users.find(u => u.id === requesterId);
    if (requester) {
        if (!requester.friends) requester.friends = [];
        requester.friends.push(currentUser.id);
    }
    
    // Remove from friend requests
    if (!currentUser.friendRequests) currentUser.friendRequests = [];
    currentUser.friendRequests = currentUser.friendRequests.filter(id => id !== requesterId);
    
    // Update UI
    updateDashboardCounts();
    saveDataToStorage();
    showRequests(); // Refresh the requests view
    
    showNotification('Friend request accepted!', 'success');
}

function declineFriendRequest(requesterId) {
    console.log('Declining friend request from:', requesterId);
    if (!currentUser) {
        showNotification('Please sign in first.', 'danger');
        return;
    }
    
    // Remove from friend requests
    if (!currentUser.friendRequests) currentUser.friendRequests = [];
    currentUser.friendRequests = currentUser.friendRequests.filter(id => id !== requesterId);
    
    // Update UI
    updateDashboardCounts();
    saveDataToStorage();
    showRequests(); // Refresh the requests view
    
    showNotification('Friend request declined.', 'info');
}

// Global variable to track profile button mode and navbar state
let isSignedInMode = false;
window.isSignedInMode = false; // Expose globally for debugging
let navbarUpdateInProgress = false;

/**
 * Universal profile button handler
 * Routes to correct function based on user sign-in state
 */
function handleProfileButtonClick() {
    console.log('Profile button clicked, mode:', isSignedInMode ? 'Edit Profile' : 'Create Profile');
    if (isSignedInMode) {
        editProfile();
    } else {
        showSignUpModal();
    }
}
// UI Update Functions
function updateNavbarForSignedInUser() {
    // Prevent concurrent updates
    if (navbarUpdateInProgress) {
        console.log('Navbar update already in progress, skipping');
        return;
    }
    navbarUpdateInProgress = true;
    
    try {
        console.log('🔄 Updating navbar for signed-in user:', currentUser?.fullName);
        
        // Set mode flag FIRST
        isSignedInMode = true;
        window.isSignedInMode = true; // Sync with global
        
        // Update button appearance
        const openProfileBtn = document.getElementById('openProfileBtn');
        if (openProfileBtn) {
            openProfileBtn.innerHTML = '<i class="bi bi-pencil"></i> Edit Profile';
            console.log('✅ Button updated to Edit Profile');
        }
        
        // Hide sign-in button
        const signInBtn = document.getElementById('openSignInBtn');
        if (signInBtn) {
            signInBtn.style.display = 'none';
        }
        
        // Show user area
        const userNavArea = document.getElementById('userNavArea');
        if (userNavArea) {
            userNavArea.setAttribute('style', 'display: flex !important;');
        }
        
        // Update user avatar and username with improved reliability
        const navUserAvatar = document.getElementById('navUserAvatar');
        const navUsername = document.getElementById('navUsername');
        
        if (navUserAvatar && currentUser) {
            console.log('🖼️ Setting navbar avatar. Current user avatar:', currentUser.avatar);
            
            // Default avatar URL
            const defaultAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(currentUser.fullName || 'User') + '&background=007bff&color=ffffff&size=40';
            
            // Check for problematic URLs or missing avatar
            if (!currentUser.avatar || 
                currentUser.avatar.includes('localhost') || 
                currentUser.avatar.includes('blob:') || 
                currentUser.avatar === '' || 
                currentUser.avatar === 'null') {
                console.warn('⚠️ Using default avatar for navbar');
                navUserAvatar.src = defaultAvatar;
            } else {
                navUserAvatar.src = currentUser.avatar;
                // Fallback if image fails to load
                navUserAvatar.onerror = function() {
                    console.warn('⚠️ Avatar failed to load, using default');
                    this.src = defaultAvatar;
                    this.onerror = null; // Prevent infinite loop
                };
            }
        }
        
        if (navUsername && currentUser && currentUser.username) {
            navUsername.textContent = `@${currentUser.username}`;
        }
        
        console.log('✅ Navbar update completed for signed-in state');
        
    } catch (error) {
        console.error('❌ Error updating navbar for signed-in user:', error);
    } finally {
        navbarUpdateInProgress = false;
    }
}

function updateNavbarForSignedOutUser() {
    try {
        console.log('🔄 Updating navbar for signed-out user');
        
        // Set mode flag FIRST
        isSignedInMode = false;
        window.isSignedInMode = false; // Sync with global
        
        // Update button appearance
        const openProfileBtn = document.getElementById('openProfileBtn');
        if (openProfileBtn) {
            openProfileBtn.innerHTML = '<i class="bi bi-person-plus"></i> Create Profile';
            console.log('✅ Button updated to Create Profile');
        }
        
        // Show sign-in button
        const signInBtn = document.getElementById('openSignInBtn');
        if (signInBtn) {
            signInBtn.style.display = 'inline-block';
        }
        
        // Hide user area
        const userNavArea = document.getElementById('userNavArea');
        if (userNavArea) {
            userNavArea.setAttribute('style', 'display: none !important;');
        }
        
        console.log('✅ Navbar update completed for signed-out state');
        
    } catch (error) {
        console.error('❌ Error updating navbar for signed-out user:', error);
    }
}

function updateDashboardContent() {
    if (!currentUser) return;
    
    // Default avatar URL with user's name
    const defaultAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(currentUser.fullName || 'User') + '&background=007bff&color=ffffff&size=80';
    
    // Update composer avatar
    const composerAvatar = document.getElementById('composerAvatar');
    if (composerAvatar) {
        if (!currentUser.avatar || currentUser.avatar.includes('localhost') || currentUser.avatar.includes('blob:')) {
            composerAvatar.src = defaultAvatar;
        } else {
            composerAvatar.src = currentUser.avatar;
            composerAvatar.onerror = function() { this.src = defaultAvatar; this.onerror = null; };
        }
    }
    
    // Update sidebar profile
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    if (sidebarAvatar) {
        if (!currentUser.avatar || currentUser.avatar.includes('localhost') || currentUser.avatar.includes('blob:')) {
            sidebarAvatar.src = defaultAvatar;
        } else {
            sidebarAvatar.src = currentUser.avatar;
            sidebarAvatar.onerror = function() { this.src = defaultAvatar; this.onerror = null; };
        }
    }
    
    document.getElementById('sidebarUsername').textContent = `@${currentUser.username}`;
    document.getElementById('sidebarFullName').textContent = currentUser.fullName;
    
    // Update counts with dynamic colors using the centralized function
    updateDashboardCounts();
}

function updateDashboardCounts() {
    if (!currentUser) return;
    
    // Update Friends count (always primary blue)
    const friendsCount = currentUser.friends?.length || 0;
    const friendsBadge = document.getElementById('friendsCount');
    if (friendsBadge) {
        friendsBadge.textContent = friendsCount;
        friendsBadge.className = 'badge bg-primary rounded-pill';
    }
    
    // Update Requests count (success green if > 0, primary blue if 0)
    const requestsCount = currentUser.friendRequests?.length || 0;
    const requestsBadge = document.getElementById('requestsCount');
    if (requestsBadge) {
        requestsBadge.textContent = requestsCount;
        requestsBadge.className = requestsCount > 0 ? 'badge bg-success rounded-pill' : 'badge bg-primary rounded-pill';
    }
    
    // Update Messages count (success green if unread messages > 0, primary blue if 0)
    const unreadCount = getUnreadMessagesCount();
    const messagesBadge = document.getElementById('messagesCount');
    if (messagesBadge) {
        messagesBadge.textContent = unreadCount;
        messagesBadge.className = unreadCount > 0 ? 'badge bg-success rounded-pill' : 'badge bg-primary rounded-pill';
    }
}

function loadNewsFeed() {
    if (!currentUser) return;
    
    const newsFeedContainer = document.getElementById('newsFeed');
    newsFeedContainer.innerHTML = '';
    
    // Initialize user news subscriptions if not exists
    if (!userNewsSubscriptions[currentUser.id]) {
        userNewsSubscriptions[currentUser.id] = [...currentUser.interests];
    }
    
    const userSources = userNewsSubscriptions[currentUser.id];
    
    // Get news based on user's subscribed interests
    userSources.forEach(interest => {
        if (newsFeeds[interest]) {
            newsFeeds[interest].slice(0, 3).forEach(news => {
                const newsItem = document.createElement('div');
                newsItem.className = 'news-item';
                newsItem.innerHTML = `
                    <div class="news-content">
                        <a href="${news.url}" target="_blank" class="news-title-link">
                            <div class="news-title">${news.title}</div>
                        </a>
                        ${news.summary ? `<div class="news-summary text-muted small mb-2">${news.summary}</div>` : ''}
                        <div class="news-meta">
                            <span class="news-source">${news.source}</span>
                            <span class="news-time">${news.time}</span>
                        </div>
                    </div>
                    <div class="news-actions">
                        <button class="btn btn-sm btn-outline-secondary me-1" onclick="shareNewsAsPost('${encodeURIComponent(news.title)}', '${news.url}', '${news.source}')" title="Share as post">
                            <i class="bi bi-share"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="unfollowNewsSource('${interest}')" title="Unfollow ${interest} news">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                `;
                newsFeedContainer.appendChild(newsItem);
            });
        }
    });
    
    if (newsFeedContainer.children.length === 0) {
        newsFeedContainer.innerHTML = `
            <div class="text-center p-3 text-muted">
                <i class="bi bi-newspaper fs-4 d-block mb-2"></i>
                <p class="mb-0">No news available</p>
                <small>Follow topics to see news here</small>
            </div>
        `;
    }
}

function populateProfilePage(user) {
    document.getElementById('profileAvatar').src = user.avatar;
    document.getElementById('profileFullName').textContent = user.fullName;
    document.getElementById('profileUsername').textContent = `@${user.username}`;
    document.getElementById('profileLocation').querySelector('span').textContent = `${user.city}, ${user.state}, ${user.country}`;
    
    // Populate About Me section if it exists
    const aboutMeContainer = document.getElementById('profileAboutMe');
    if (aboutMeContainer) {
        if (user.aboutMe && user.aboutMe.trim()) {
            aboutMeContainer.innerHTML = `
                <div class="about-me-section">
                    <p class="about-me-text">"${user.aboutMe}"</p>
                </div>
            `;
            aboutMeContainer.style.display = 'block';
        } else {
            aboutMeContainer.style.display = 'none';
        }
    }
    
    // Populate interests
    const interestsContainer = document.getElementById('profileInterests');
    interestsContainer.innerHTML = '';
    user.interests.forEach(interest => {
        const badge = document.createElement('span');
        badge.className = 'interest-badge';
        badge.textContent = interest;
        interestsContainer.appendChild(badge);
    });
    
    // Profile actions
    const actionsContainer = document.getElementById('profileActions');
    if (currentUser && user.id === currentUser.id) {
        actionsContainer.innerHTML = `
            <button class="btn btn-secondary" onclick="editProfile()">
                <i class="bi bi-pencil"></i> Edit Profile
            </button>
            <button class="btn btn-outline-secondary" onclick="showDashboard()">
                <i class="bi bi-house"></i> Back to Dashboard
            </button>
        `;
    } else {
        actionsContainer.innerHTML = `
            <button class="btn btn-primary" onclick="sendFriendRequest(${user.id})">
                <i class="bi bi-person-plus"></i> Add Friend
            </button>
            <button class="btn btn-outline-primary" onclick="checkAuthAndMessage(${user.id})">
                <i class="bi bi-chat"></i> Message
            </button>
            <button class="btn btn-outline-secondary" onclick="${currentUser ? 'showDashboard()' : 'showLanding()'}">
                <i class="bi bi-arrow-left"></i> Back
            </button>
        `;
    }
    
    // Load user's posts (only if user is signed in)
    if (currentUser) {
        loadUserProfilePosts(user);
    } else {
        // Hide posts for non-signed users
        const postsContainer = document.getElementById('profilePosts');
        postsContainer.innerHTML = `
            <div class="text-center p-4 text-muted">
                <i class="bi bi-lock fs-1 d-block mb-3"></i>
                <h6>Sign in to view posts</h6>
                <p>Please sign in to see this user's posts.</p>
            </div>
        `;
    }
}

/**
 * Load user posts for profile page from Firebase
 */
async function loadUserProfilePosts(user) {
    const postsContainer = document.getElementById('profilePosts');
    
    // Show loading state
    postsContainer.innerHTML = '<div class="text-center p-4"><span class="loading-spinner"></span> Loading posts...</div>';
    
    try {
        // Get posts from Firestore for this specific user
        const snapshot = await db.collection('posts')
            .where('authorId', '==', user.uid || user.id) // Handle both Firebase UID and legacy ID
            .get();
        
        if (snapshot.empty) {
            postsContainer.innerHTML = `
                <div class="text-center p-4 text-muted">
                    <i class="bi bi-grid fs-1 d-block mb-3"></i>
                    <h6>No posts yet</h6>
                    ${currentUser && (user.uid === currentUser.uid || user.id === currentUser.id) ? '<p>Share your first post!</p>' : '<p>This user hasn\'t posted anything yet.</p>'}
                </div>
            `;
            return;
        }
        
        // Convert to array and sort by timestamp (client-side sorting)
        const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        posts.sort((a, b) => {
            const timeA = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
            const timeB = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
            return timeB - timeA; // Newest first
        });
        
        postsContainer.innerHTML = '';
        
        posts.forEach(post => {
            const postElement = createProfilePostElement(post, user);
            postsContainer.appendChild(postElement);
        });
        
    } catch (error) {
        console.error('Error loading user posts:', error);
        postsContainer.innerHTML = `
            <div class="text-center p-4 text-danger">
                <i class="bi bi-exclamation-triangle fs-1 d-block mb-3"></i>
                <h5>Error loading posts</h5>
                <p>Please refresh the page to try again.</p>
                <p class="small text-muted">Error: ${error.message}</p>
            </div>
        `;
    }
}

/**
 * Create post element for profile page
 */
function createProfilePostElement(post, user) {
    const postElement = document.createElement('div');
    postElement.className = 'post-item mb-3';
    postElement.setAttribute('data-post-id', post.id);
    
    // Convert Firestore timestamp
    const timestamp = post.timestamp && post.timestamp.toDate ? post.timestamp.toDate() : new Date(post.timestamp);
    const timeAgo = getTimeAgo(timestamp);
    
    // Check if current user is the author (for edit/delete menu)
    const isAuthor = currentUser && (post.authorId === currentUser.uid);
    
    postElement.innerHTML = `
        <div class="post-header">
            <img src="${post.authorAvatar || user.avatar}" 
                 alt="${post.authorName || user.fullName}" 
                 class="post-avatar cursor-pointer" 
                 onclick="showProfileByAuthor('${post.authorId}')">
            <div class="post-author-info">
                <div class="post-author cursor-pointer" onclick="showProfileByAuthor('${post.authorId}')">${post.authorName || user.fullName}</div>
                <div class="post-time">${timeAgo}</div>
            </div>
            ${isAuthor ? `
                <div class="dropdown">
                    <button class="post-menu-btn" onclick="togglePostMenu('${post.id}')" id="postMenuBtn_${post.id}">
                        <i class="bi bi-three-dots"></i>
                    </button>
                    <div class="post-menu" id="postMenu_${post.id}">
                        <button class="post-menu-item" onclick="editPost('${post.id}')">
                            <i class="bi bi-pencil"></i> Edit
                        </button>
                        <button class="post-menu-item text-danger" onclick="confirmDeletePost('${post.id}')">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            ` : ''}
        </div>
        <div class="post-content">${post.content}</div>
        ${post.media ? createMediaElement(post.media) : ''}
        <div class="post-actions">
            <button class="post-action ${post.likes && post.likes.includes(currentUser?.uid) ? 'liked' : ''}" onclick="toggleLike('${post.id}')">
                <i class="bi bi-heart${post.likes && post.likes.includes(currentUser?.uid) ? '-fill' : ''}"></i> ${post.likes ? post.likes.length : 0}
            </button>
            <button class="post-action" onclick="toggleComments('${post.id}')">
                <i class="bi bi-chat"></i> ${post.comments ? post.comments.length : 0}
            </button>
            <button class="post-action" onclick="sharePost('${post.id}')">
                <i class="bi bi-share"></i> ${post.shares || 0}
            </button>
        </div>
        <div id="comments_${post.id}" style="display: none;" class="mt-3 px-3 pb-3">
            ${post.comments ? post.comments.map(comment => createCommentElement(comment)).join('') : ''}
            <div class="d-flex mt-2">
                <img src="${currentUser ? currentUser.avatar : ''}" class="rounded-circle me-2" style="width:30px;height:30px;object-fit:cover;">
                <input type="text" class="form-control" placeholder="Write a comment..." onkeypress="handleCommentSubmit(event, '${post.id}')">
            </div>
        </div>
    `;
    
    return postElement;
}

// --------------------------------------------------
// Lightweight Debug Utility (toggle in console via window.TRUEFEW_DEBUG=true)
// --------------------------------------------------
if (typeof window !== 'undefined' && typeof window.TRUEFEW_DEBUG === 'undefined') {
    window.TRUEFEW_DEBUG = false; // set true in DevTools to enable verbose logs
}
function tfDebug() {
    if (typeof window !== 'undefined' && window.TRUEFEW_DEBUG) {
        try { console.log.apply(console, ['[TF]', ...arguments]); } catch(_) {}
    }
}

// Post Functions
// ===========================
// ENHANCED POST CRUD SYSTEM WITH FIREBASE
// ===========================

// Global variables for post management
let currentEditingPostId = null;
let currentDeletingPostId = null;
let currentEditingPost = null;
let editAttachedMedia = null;

/**
 * Enhanced publishPost function with Firebase integration
 */
async function publishPost() {
    if (!currentUser) {
        showSignInModal();
        return;
    }
    
    const content = document.getElementById('postContent').value.trim();
    
    if (!content && !attachedMedia) {
        showNotification('Please write something or attach media to post.', 'warning');
        return;
    }
    
    try {
        // Show loading state
        const publishBtn = document.getElementById('publishPost');
        const originalText = publishBtn.innerHTML;
        publishBtn.innerHTML = '<span class="loading-spinner"></span> Publishing...';
        publishBtn.disabled = true;
        
        // Create post object
        const newPost = {
            authorId: currentUser.uid,
            authorName: currentUser.fullName,
            authorAvatar: currentUser.avatar,
            content: content || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            likes: [],
            comments: [],
            shares: 0,
            media: attachedMedia || null
        };
        
        // Save to Firestore
        await db.collection('posts').add(newPost);
        
        // Clear composer
        document.getElementById('postContent').value = '';
        attachedMedia = null;
        updateAttachmentButtons();
        
        // Reload posts feed
        await loadPostsFeed();
        
        // Reset button
        publishBtn.innerHTML = originalText;
        publishBtn.disabled = false;
        
        showNotification('Post published successfully!', 'success');
        
    } catch (error) {
        console.error('Error publishing post:', error);
        showNotification('Failed to publish post. Please try again.', 'danger');
        
        // Reset button
        const publishBtn = document.getElementById('publishPost');
        publishBtn.innerHTML = 'Post';
        publishBtn.disabled = false;
    }
}

/**
 * Enhanced loadPostsFeed function with Firebase integration
 */
async function loadPostsFeed() {
    const postsFeed = document.getElementById('postsFeed');
    if (!postsFeed) return;
    
    postsFeed.innerHTML = '<div class="text-center p-4"><span class="loading-spinner"></span> Loading posts...</div>';
    
    try {
        // Get posts from Firestore (ordered by timestamp, newest first)
        const snapshot = await db.collection('posts')
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();
        
        if (snapshot.empty) {
            postsFeed.innerHTML = `
                <div class="text-center p-4 text-muted">
                    <i class="bi bi-chat-square-text fs-1 d-block mb-3"></i>
                    <h5>No posts yet</h5>
                    <p>Be the first to share something!</p>
                </div>
            `;
            return;
        }
        
        postsFeed.innerHTML = '';
        
        snapshot.docs.forEach(doc => {
            const post = { id: doc.id, ...doc.data() };
            const postElement = createPostElement(post);
            postsFeed.appendChild(postElement);
        });
        
    } catch (error) {
        console.error('Error loading posts:', error);
        postsFeed.innerHTML = `
            <div class="text-center p-4 text-danger">
                <i class="bi bi-exclamation-triangle fs-1 d-block mb-3"></i>
                <h5>Error loading posts</h5>
                <p>Please refresh the page to try again.</p>
            </div>
        `;
    }
}

/**
 * Create post element with 3-dot menu for CRUD operations
 */
function createPostElement(post) {
    const postElement = document.createElement('div');
    postElement.className = 'post-item fade-in';
    postElement.setAttribute('data-post-id', post.id);
    
    // Convert Firestore timestamp
    const timestamp = post.timestamp && post.timestamp.toDate ? post.timestamp.toDate() : new Date(post.timestamp);
    const timeAgo = getTimeAgo(timestamp);
    
    // Check if current user liked the post
    const isLiked = currentUser && post.likes && post.likes.includes(currentUser.uid);
    const isAuthor = currentUser && post.authorId === currentUser.uid;
    
    postElement.innerHTML = `
        <div class="post-header">
            <img src="${post.authorAvatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(post.authorName || 'User')}" 
                 alt="${post.authorName}" 
                 class="post-avatar cursor-pointer" 
                 onclick="showProfileByAuthor('${post.authorId}')">
            <div class="post-author-info">
                <div class="post-author cursor-pointer" onclick="showProfileByAuthor('${post.authorId}')">${post.authorName || 'Unknown User'}</div>
                <div class="post-time">${timeAgo}</div>
            </div>
            ${isAuthor ? `
                <div class="dropdown">
                    <button class="post-menu-btn" onclick="togglePostMenu('${post.id}')" id="postMenuBtn_${post.id}">
                        <i class="bi bi-three-dots"></i>
                    </button>
                    <div class="post-menu" id="postMenu_${post.id}">
                        <button class="post-menu-item" onclick="editPost('${post.id}')">
                            <i class="bi bi-pencil"></i> Edit
                        </button>
                        <button class="post-menu-item text-danger" onclick="confirmDeletePost('${post.id}')">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            ` : ''}
        </div>
        <div class="post-content">${post.content}</div>
        ${post.media ? createMediaElement(post.media) : ''}
        <div class="post-actions">
            <button class="post-action ${isLiked ? 'liked' : ''}" onclick="toggleLike('${post.id}')">
                <i class="bi bi-heart${isLiked ? '-fill' : ''}"></i> ${post.likes ? post.likes.length : 0}
            </button>
            <button class="post-action" onclick="toggleComments('${post.id}')">
                <i class="bi bi-chat"></i> ${post.comments ? post.comments.length : 0}
            </button>
            <button class="post-action" onclick="sharePost('${post.id}')">
                <i class="bi bi-share"></i> ${post.shares || 0}
            </button>
        </div>
        <div id="comments_${post.id}" style="display: none;" class="mt-3 px-3 pb-3">
            ${post.comments ? post.comments.map(comment => createCommentElement(comment)).join('') : ''}
            <div class="d-flex mt-2">
                <img src="${currentUser ? currentUser.avatar : ''}" class="rounded-circle me-2" style="width:30px;height:30px;object-fit:cover;">
                <input type="text" class="form-control" placeholder="Write a comment..." onkeypress="handleCommentSubmit(event, '${post.id}')">
            </div>
        </div>
    `;
    
    return postElement;
}

/**
 * Create media element for posts
 */
function createMediaElement(media) {
    if (!media) return '';
    
    switch (media.type) {
        case 'image':
            return `<div class="post-media px-3 pb-2">
                <img src="${media.url}" alt="Post image" class="img-fluid rounded">
            </div>`;
        case 'video':
            if (media.service === 'youtube') {
                return `<div class="post-media px-3 pb-2">
                    <div class="ratio ratio-16x9">
                        <iframe src="${media.embedUrl}" 
                                title="YouTube video player" 
                                frameborder="0" 
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                                allowfullscreen
                                class="rounded">
                        </iframe>
                    </div>
                </div>`;
            }
            break;
        case 'music':
            if (media.service === 'spotify') {
                return `<div class="post-media px-3 pb-2">
                    <iframe src="${media.embedUrl}" 
                            width="100%" 
                            height="152" 
                            frameborder="0" 
                            allowtransparency="true" 
                            allow="encrypted-media"
                            class="rounded">
                    </iframe>
                </div>`;
            }
            break;
        default:
            return `<div class="post-media px-3 pb-2">
                <div class="p-3 bg-light rounded">
                    <i class="bi bi-link me-2"></i>
                    <a href="${media.url}" target="_blank">${media.title || 'Media Link'}</a>
                </div>
            </div>`;
    }
    return '';
}

/**
 * Create comment element
 */
function createCommentElement(comment) {
    const timestamp = comment.timestamp && comment.timestamp.toDate ? comment.timestamp.toDate() : new Date(comment.timestamp);
    return `
        <div class="d-flex mb-2">
            <img src="${comment.authorAvatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(comment.authorName || 'User')}" 
                 class="rounded-circle me-2" style="width:30px;height:30px;object-fit:cover;">
            <div class="flex-grow-1">
                <strong>${comment.authorName || 'Unknown User'}</strong>
                <span class="text-muted ms-2">${getTimeAgo(timestamp)}</span>
                <div>${comment.content}</div>
            </div>
        </div>
    `;
}

/**
 * Toggle post menu visibility
 */
function togglePostMenu(postId) {
    // Close all other open menus
    document.querySelectorAll('.post-menu.show').forEach(menu => {
        if (menu.id !== `postMenu_${postId}`) {
            menu.classList.remove('show');
        }
    });
    
    // Toggle current menu
    const menu = document.getElementById(`postMenu_${postId}`);
    if (menu) {
        menu.classList.toggle('show');
    }
}

// Close post menus when clicking outside
document.addEventListener('click', function(event) {
    if (!event.target.closest('.post-menu-btn') && !event.target.closest('.post-menu')) {
        document.querySelectorAll('.post-menu.show').forEach(menu => {
            menu.classList.remove('show');
        });
    }
});

/**
 * Enhanced toggleLike function with Firebase
 */
async function toggleLike(postId) {
    if (!currentUser) {
        showSignInModal();
        return;
    }
    
    try {
        const postRef = db.collection('posts').doc(postId);
        const postDoc = await postRef.get();
        
        if (!postDoc.exists) {
            showNotification('Post not found', 'error');
            return;
        }
        
        const post = postDoc.data();
        const likes = post.likes || [];
        const userIndex = likes.indexOf(currentUser.uid);
        
        if (userIndex > -1) {
            // Remove like
            likes.splice(userIndex, 1);
        } else {
            // Add like
            likes.push(currentUser.uid);
        }
        
        await postRef.update({ likes });
        
        // Update UI immediately
        const likeBtn = document.querySelector(`[data-post-id="${postId}"] .post-action`);
        if (likeBtn) {
            const isLiked = likes.includes(currentUser.uid);
            likeBtn.className = `post-action ${isLiked ? 'liked' : ''}`;
            likeBtn.innerHTML = `<i class="bi bi-heart${isLiked ? '-fill' : ''}"></i> ${likes.length}`;
        }
        
    } catch (error) {
        console.error('Error toggling like:', error);
        showNotification('Failed to update like. Please try again.', 'danger');
    }
}

/**
 * Enhanced toggleComments function  
 */
function toggleComments(postId) {
    const commentsDiv = document.getElementById(`comments_${postId}`);
    if (commentsDiv) {
        commentsDiv.style.display = commentsDiv.style.display === 'none' ? 'block' : 'none';
    }
}

/**
 * Enhanced handleCommentSubmit function with Firebase
 */
async function handleCommentSubmit(event, postId) {
    if (event.key === 'Enter' && event.target.value.trim()) {
        if (!currentUser) {
            showSignInModal();
            return;
        }
        
        try {
            const content = event.target.value.trim();
            const comment = {
                authorId: currentUser.uid,
                authorName: currentUser.fullName,
                authorAvatar: currentUser.avatar,
                content: content,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            const postRef = db.collection('posts').doc(postId);
            await postRef.update({
                comments: firebase.firestore.FieldValue.arrayUnion(comment)
            });
            
            event.target.value = '';
            await loadPostsFeed();
            
            // Re-open comments section
            setTimeout(() => {
                const commentsDiv = document.getElementById(`comments_${postId}`);
                if (commentsDiv) {
                    commentsDiv.style.display = 'block';
                }
            }, 100);
            
        } catch (error) {
            console.error('Error adding comment:', error);
            showNotification('Failed to add comment. Please try again.', 'danger');
        }
    }
}

/**
 * Enhanced sharePost function with Firebase
 */
async function sharePost(postId) {
    if (!currentUser) {
        showSignInModal();
        return;
    }
    
    try {
        const postRef = db.collection('posts').doc(postId);
        await postRef.update({
            shares: firebase.firestore.FieldValue.increment(1)
        });
        
        // Update UI immediately
        const shareBtn = document.querySelector(`[data-post-id="${postId}"] .post-action:nth-child(3)`);
        if (shareBtn) {
            const currentShares = parseInt(shareBtn.textContent.split(' ')[1]) || 0;
            shareBtn.innerHTML = `<i class="bi bi-share"></i> ${currentShares + 1}`;
        }
        
        showNotification('Post shared!', 'success');
        
    } catch (error) {
        console.error('Error sharing post:', error);
        showNotification('Failed to share post. Please try again.', 'danger');
    }
}

/**
 * Show profile by author ID
 */
function showProfileByAuthor(authorId) {
    // Use the main showProfile function with navigation state tracking
    showProfile(authorId);
}

/**
 * Edit post function
 */
async function editPost(postId) {
    try {
        const postRef = db.collection('posts').doc(postId);
        const postDoc = await postRef.get();
        
        if (!postDoc.exists) {
            showNotification('Post not found', 'error');
            return;
        }
        
        const post = postDoc.data();
        
        // Check if user is the author
        if (post.authorId !== currentUser.uid) {
            showNotification('You can only edit your own posts', 'warning');
            return;
        }
        
        // Set current editing post
        currentEditingPostId = postId;
        currentEditingPost = post;
        editAttachedMedia = post.media ? { ...post.media } : null;
        
        // Populate edit modal
        const editPostContent = document.getElementById('editPostContent');
        const editPostCounter = document.getElementById('editPostCounter');
        
        editPostContent.value = post.content || '';
        updateEditPostCounter();
        
        // Show current media if exists
        const editCurrentMedia = document.getElementById('editCurrentMedia');
        const editCurrentMediaPreview = document.getElementById('editCurrentMediaPreview');
        
        if (post.media) {
            editCurrentMediaPreview.innerHTML = createMediaPreview(post.media);
            editCurrentMedia.style.display = 'block';
        } else {
            editCurrentMedia.style.display = 'none';
        }
        
        // Reset new media preview and buttons
        document.getElementById('editNewMediaPreview').style.display = 'none';
        updateEditAttachmentButtons();
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('editPostModal'));
        modal.show();
        
        // Close post menu
        document.querySelectorAll('.post-menu.show').forEach(menu => {
            menu.classList.remove('show');
        });
        
    } catch (error) {
        console.error('Error loading post for edit:', error);
        showNotification('Failed to load post for editing', 'danger');
    }
}

/**
 * Save edited post
 */
async function saveEditPost() {
    if (!currentEditingPostId) return;
    
    const content = document.getElementById('editPostContent').value.trim();
    
    if (!content && !editAttachedMedia) {
        showNotification('Post must have content or media', 'warning');
        return;
    }
    
    try {
        const saveBtn = document.getElementById('saveEditPostBtn');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<span class="loading-spinner"></span> Saving...';
        saveBtn.disabled = true;
        
        const updateData = {
            content: content,
            media: editAttachedMedia,
            editedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await db.collection('posts').doc(currentEditingPostId).update(updateData);
        
        // Close modal
        bootstrap.Modal.getInstance(document.getElementById('editPostModal')).hide();
        
        // Reload posts
        await loadPostsFeed();
        
        showNotification('Post updated successfully!', 'success');
        
        // Reset editing state
        currentEditingPostId = null;
        currentEditingPost = null;
        editAttachedMedia = null;
        
        saveBtn.innerHTML = originalText;
        saveBtn.disabled = false;
        
    } catch (error) {
        console.error('Error updating post:', error);
        showNotification('Failed to update post. Please try again.', 'danger');
        
        const saveBtn = document.getElementById('saveEditPostBtn');
        saveBtn.innerHTML = '<i class="bi bi-check"></i> Save Changes';
        saveBtn.disabled = false;
    }
}

/**
 * Update character counter for edit post
 */
function updateEditPostCounter() {
    const editPostContent = document.getElementById('editPostContent');
    const editPostCounter = document.getElementById('editPostCounter');
    
    if (editPostContent && editPostCounter) {
        const length = editPostContent.value.length;
        editPostCounter.textContent = `${length}/1000 characters`;
        
        if (length > 900) {
            editPostCounter.className = 'character-counter danger';
        } else if (length > 800) {
            editPostCounter.className = 'character-counter warning';
        } else {
            editPostCounter.className = 'character-counter';
        }
    }
}

/**
 * Confirm delete post
 */
function confirmDeletePost(postId) {
    currentDeletingPostId = postId;
    const modal = new bootstrap.Modal(document.getElementById('deletePostModal'));
    modal.show();
    
    // Close post menu
    document.querySelectorAll('.post-menu.show').forEach(menu => {
        menu.classList.remove('show');
    });
}

/**
 * Execute post deletion
 */
async function executeDeletePost() {
    if (!currentDeletingPostId) return;
    
    try {
        const deleteBtn = document.getElementById('confirmDeletePostBtn');
        const originalText = deleteBtn.innerHTML;
        deleteBtn.innerHTML = '<span class="loading-spinner"></span> Deleting...';
        deleteBtn.disabled = true;
        
        await db.collection('posts').doc(currentDeletingPostId).delete();
        
        // Close modal
        bootstrap.Modal.getInstance(document.getElementById('deletePostModal')).hide();
        
        // Reload posts
        await loadPostsFeed();
        
        showNotification('Post deleted successfully!', 'success');
        currentDeletingPostId = null;
        
        deleteBtn.innerHTML = originalText;
        deleteBtn.disabled = false;
        
    } catch (error) {
        console.error('Error deleting post:', error);
        showNotification('Failed to delete post. Please try again.', 'danger');
        
        const deleteBtn = document.getElementById('confirmDeletePostBtn');
        deleteBtn.innerHTML = '<i class="bi bi-trash"></i> Delete Post';
        deleteBtn.disabled = false;
    }
}

// ===========================
// PROFILE DELETION SYSTEM
// ===========================

/**
 * Confirm profile deletion
 */
function confirmDeleteProfile() {
    const modal = new bootstrap.Modal(document.getElementById('deleteProfileModal'));
    modal.show();
    
    // Set up confirmation text validation
    const deleteConfirmText = document.getElementById('deleteConfirmText');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    
    deleteConfirmText.addEventListener('input', function() {
        confirmDeleteBtn.disabled = this.value.trim().toUpperCase() !== 'DELETE';
    });
}

/**
 * Execute profile deletion
 */
async function executeDeleteProfile() {
    const confirmText = document.getElementById('deleteConfirmText').value.trim();
    
    if (confirmText.toUpperCase() !== 'DELETE') {
        showNotification('Please type "DELETE" to confirm', 'warning');
        return;
    }
    
    if (!currentUser) {
        showNotification('No user logged in', 'error');
        return;
    }
    
    try {
        const deleteBtn = document.getElementById('confirmDeleteBtn');
        const originalText = deleteBtn.innerHTML;
        deleteBtn.innerHTML = '<span class="loading-spinner"></span> Deleting...';
        deleteBtn.disabled = true;
        
        // Delete user's posts
        const userPostsQuery = await db.collection('posts').where('authorId', '==', currentUser.uid).get();
        const batch = db.batch();
        
        userPostsQuery.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        // Delete user document
        batch.delete(db.collection('users').doc(currentUser.uid));
        
        await batch.commit();
        
        // Delete Firebase auth account
        await auth.currentUser.delete();
        
        // Clear local data
        localStorage.clear();
        currentUser = null;
        
        // Close modal and show landing page
        bootstrap.Modal.getInstance(document.getElementById('deleteProfileModal')).hide();
        bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
        
        showLanding();
        showNotification('Profile deleted successfully. We\'re sorry to see you go!', 'success');
        
    } catch (error) {
        console.error('Error deleting profile:', error);
        
        let errorMessage = 'Failed to delete profile. Please try again.';
        if (error.code === 'auth/requires-recent-login') {
            errorMessage = 'Please sign out and sign back in, then try deleting your profile again.';
        }
        
        showNotification(errorMessage, 'danger');
        
        const deleteBtn = document.getElementById('confirmDeleteBtn');
        deleteBtn.innerHTML = '<i class="bi bi-trash"></i> Delete My Profile';
        deleteBtn.disabled = false;
    }
}

// ===========================
// EDIT POST MEDIA FUNCTIONS
// ===========================

/**
 * Create media preview for display
 */
function createMediaPreview(media) {
    if (!media) return '';
    
    switch (media.type) {
        case 'image':
            return `<img src="${media.url}" alt="Post image" class="img-fluid rounded" style="max-height: 200px;">`;
        case 'video':
            if (media.service === 'youtube') {
                return `<div class="d-flex align-items-center">
                    <i class="bi bi-youtube text-danger me-2"></i>
                    <div>
                        <strong>YouTube Video</strong><br>
                        <small class="text-muted">${media.title || 'Video'}</small>
                    </div>
                </div>`;
            }
            break;
        case 'music':
            if (media.service === 'spotify') {
                return `<div class="d-flex align-items-center">
                    <i class="bi bi-spotify text-success me-2"></i>
                    <div>
                        <strong>Spotify Track</strong><br>
                        <small class="text-muted">${media.title || 'Music'}</small>
                    </div>
                </div>`;
            } else if (media.service === 'apple') {
                return `<div class="d-flex align-items-center">
                    <i class="bi bi-music-note text-primary me-2"></i>
                    <div>
                        <strong>Apple Music</strong><br>
                        <small class="text-muted">${media.title || 'Music'}</small>
                    </div>
                </div>`;
            }
            break;
        default:
            return `<div class="d-flex align-items-center">
                <i class="bi bi-link me-2"></i>
                <div>
                    <strong>Media Link</strong><br>
                    <small class="text-muted">${media.title || media.url}</small>
                </div>
            </div>`;
    }
    return '';
}

/**
 * Remove current media from edit post
 */
function removeEditMedia() {
    editAttachedMedia = null;
    document.getElementById('editCurrentMedia').style.display = 'none';
    updateEditAttachmentButtons();
}

/**
 * Update edit post attachment buttons
 */
function updateEditAttachmentButtons() {
    const photoBtn = document.getElementById('editAttachPhotoBtn');
    const videoBtn = document.getElementById('editAttachVideoBtn');
    const musicBtn = document.getElementById('editAttachMusicBtn');
    const clearBtn = document.getElementById('editClearAttachmentBtn');
    
    if (!photoBtn || !videoBtn || !musicBtn || !clearBtn) return;

    // Reset all buttons to default state
    photoBtn.classList.remove('btn-success');
    photoBtn.classList.add('btn-outline-secondary');
    videoBtn.classList.remove('btn-success');
    videoBtn.classList.add('btn-outline-secondary');
    musicBtn.classList.remove('btn-success');
    musicBtn.classList.add('btn-outline-secondary');

    // Update button text to default
    photoBtn.innerHTML = '<i class="bi bi-image"></i> Photo';
    videoBtn.innerHTML = '<i class="bi bi-play-circle"></i> Video';
    musicBtn.innerHTML = '<i class="bi bi-music-note"></i> Music';

    // Hide clear button by default
    clearBtn.style.display = 'none';

    // Highlight the appropriate button if media is attached
    if (editAttachedMedia) {
        clearBtn.style.display = 'inline-block';

        if (editAttachedMedia.type === 'image') {
            photoBtn.classList.remove('btn-outline-secondary');
            photoBtn.classList.add('btn-success');
            photoBtn.innerHTML = '<i class="bi bi-check-circle"></i> Photo Attached';
        } else if (editAttachedMedia.type === 'video') {
            videoBtn.classList.remove('btn-outline-secondary');
            videoBtn.classList.add('btn-success');
            videoBtn.innerHTML = '<i class="bi bi-check-circle"></i> Video Attached';
        } else if (editAttachedMedia.type === 'music') {
            musicBtn.classList.remove('btn-outline-secondary');
            musicBtn.classList.add('btn-success');
            musicBtn.innerHTML = '<i class="bi bi-check-circle"></i> Music Attached';
        }
    }
}

/**
 * Attach photo to edit post
 */
function editAttachPhoto() {
    document.getElementById('editPostPhoto').click();
}

/**
 * Preview photo for edit post
 */
async function editPreviewPhoto() {
    const fileInput = document.getElementById('editPostPhoto');
    const file = fileInput.files[0];
    
    if (!file) {
        console.log('No file selected');
        return;
    }
    
    console.log('Processing file:', file.name, 'Size:', file.size);
    
    try {
        // Check file size (limit to 10MB)
        if (file.size > 10 * 1024 * 1024) {
            showNotification('Image too large. Please select an image under 10MB.', 'danger');
            return;
        }
        
        // Check if it's an image file
        if (!file.type.startsWith('image/')) {
            showNotification('Please select a valid image file.', 'danger');
            return;
        }
        
        console.log('Calling showImageEditorForEdit...');
        
        // Show image editor modal for edit mode
        showImageEditorForEdit(file);
        
    } catch (error) {
        console.error('Error in editPreviewPhoto:', error);
        showNotification('Failed to process image. Please try again.', 'danger');
    }
}

/**
 * Show image editor for editing posts
 * @param {File} file - The image file to edit
 */
function showImageEditorForEdit(file) {
    try {
        console.log('showImageEditorForEdit called with file:', file.name);
        
        currentImageFile = file;
        
        // Check if modal exists
        const modalElement = document.getElementById('imageEditorModal');
        if (!modalElement) {
            console.error('Image editor modal not found!');
            showNotification('Image editor not available. Please try again.', 'danger');
            return;
        }
        
        const modal = new bootstrap.Modal(modalElement);
        
        // Initialize canvas first
        imageEditorCanvas = document.getElementById('imageEditorCanvas');
        if (!imageEditorCanvas) {
            console.error('Image editor canvas not found!');
            showNotification('Image editor not available. Please try again.', 'danger');
            return;
        }
        
        imageEditorCtx = imageEditorCanvas.getContext('2d');
        
        // Store that we're in edit mode
        imageEditorCanvas.dataset.editMode = 'true';
        
        console.log('Loading image file...');
        
        // Load image
        const reader = new FileReader();
        reader.onload = function(e) {
            console.log('File read successfully, creating image...');
            editorImage = new Image();
            editorImage.onload = function() {
                console.log('Image loaded, initializing editor...');
                try {
                    initializeImageEditor();
                    modal.show();
                    console.log('Image editor opened successfully');
                } catch (initError) {
                    console.error('Error initializing image editor:', initError);
                    showNotification('Failed to initialize image editor. Please try again.', 'danger');
                }
            };
            editorImage.onerror = function() {
                console.error('Failed to load image');
                showNotification('Failed to load image. Please try again.', 'danger');
            };
            editorImage.src = e.target.result;
        };
        reader.onerror = function() {
            console.error('Failed to read file');
            showNotification('Failed to read image file. Please try again.', 'danger');
        };
        reader.readAsDataURL(file);
        
    } catch (error) {
        console.error('Error in showImageEditorForEdit:', error);
        showNotification('Failed to open image editor. Please try again.', 'danger');
    }
}

/**
 * Attach video to edit post
 */
function editAttachVideo() {
    const url = prompt('Enter YouTube video URL:');
    if (!url) return;
    
    try {
        const videoData = processVideoUrl(url);
        if (videoData) {
            editAttachedMedia = videoData;
            
            document.getElementById('editNewMediaPreview').innerHTML = `
                <div class="p-3 bg-light rounded">
                    <strong>New Video:</strong><br>
                    <div class="d-flex align-items-center mt-2">
                        <i class="bi bi-youtube text-danger me-2"></i>
                        <span>${videoData.title || 'YouTube Video'}</span>
                    </div>
                </div>
            `;
            document.getElementById('editNewMediaPreview').style.display = 'block';
            
            updateEditAttachmentButtons();
            showNotification('Video attached successfully!', 'success');
        } else {
            showNotification('Invalid video URL. Please enter a valid YouTube URL.', 'warning');
        }
    } catch (error) {
        console.error('Error processing video URL:', error);
        showNotification('Failed to process video URL.', 'danger');
    }
}

/**
 * Attach music to edit post
 */
function editAttachMusic() {
    const url = prompt('Enter Spotify or Apple Music URL:');
    if (!url) return;
    
    try {
        const musicData = processMusicUrl(url);
        if (musicData) {
            editAttachedMedia = musicData;
            
            const serviceName = musicData.service === 'spotify' ? 'Spotify' : 'Apple Music';
            const iconClass = musicData.service === 'spotify' ? 'bi-spotify text-success' : 'bi-music-note text-primary';
            
            document.getElementById('editNewMediaPreview').innerHTML = `
                <div class="p-3 bg-light rounded">
                    <strong>New Music:</strong><br>
                    <div class="d-flex align-items-center mt-2">
                        <i class="bi ${iconClass} me-2"></i>
                        <span>${serviceName} - ${musicData.title || 'Music Track'}</span>
                    </div>
                </div>
            `;
            document.getElementById('editNewMediaPreview').style.display = 'block';
            
            updateEditAttachmentButtons();
            showNotification('Music attached successfully!', 'success');
        } else {
            showNotification('Invalid music URL. Please enter a valid Spotify or Apple Music URL.', 'warning');
        }
    } catch (error) {
        console.error('Error processing music URL:', error);
        showNotification('Failed to process music URL.', 'danger');
    }
}

/**
 * Clear edit post attachment
 */
function editClearAttachment() {
    editAttachedMedia = null;
    document.getElementById('editNewMediaPreview').style.display = 'none';
    document.getElementById('editPostPhoto').value = '';
    updateEditAttachmentButtons();
    showNotification('Attachment removed!', 'info');
}

// ===========================
// URL PROCESSING FUNCTIONS
// ===========================

/**
 * Process YouTube video URL
 */
function processVideoUrl(url) {
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(youtubeRegex);
    
    if (match) {
        const videoId = match[1];
        return {
            type: 'video',
            service: 'youtube',
            url: url,
            embedUrl: `https://www.youtube.com/embed/${videoId}`,
            title: 'YouTube Video'
        };
    }
    
    return null;
}

/**
 * Process Spotify or Apple Music URL
 */
function processMusicUrl(url) {
    // Spotify URL patterns
    const spotifyRegex = /(?:spotify:track:|https?:\/\/open\.spotify\.com\/track\/)([a-zA-Z0-9]+)/;
    const spotifyMatch = url.match(spotifyRegex);
    
    if (spotifyMatch) {
        const trackId = spotifyMatch[1];
        return {
            type: 'music',
            service: 'spotify',
            url: url,
            embedUrl: `https://open.spotify.com/embed/track/${trackId}`,
            title: 'Spotify Track'
        };
    }
    
    // Apple Music URL patterns
    const appleMusicRegex = /https?:\/\/music\.apple\.com\/([a-z]{2}\/)?album\/[^\/]+\/(\d+)/;
    const appleMusicMatch = url.match(appleMusicRegex);
    
    if (appleMusicMatch) {
        return {
            type: 'music',
            service: 'apple',
            url: url,
            embedUrl: url.replace('music.apple.com', 'embed.music.apple.com'),
            title: 'Apple Music Track'
        };
    }
    
    return null;
}

// ===========================
// ENHANCED PHOTO RESIZING
// ===========================

/**
 * Resize and optimize images for consistent post display
 */
async function resizeImageForPost(file, maxWidth = 800, maxHeight = 600, quality = 0.85) {
    return resizeImage(file, maxWidth, maxHeight, quality);
}

// Media Attachment Functions
function updateAttachmentButtons() {
    // Collect elements once; if not present (e.g., on landing page) exit safely
    const photoBtn = document.getElementById('attachPhotoBtn');
    const videoBtn = document.getElementById('attachVideoBtn');
    const musicBtn = document.getElementById('attachMusicBtn');
    const clearBtn = document.getElementById('clearAttachmentBtn');
    if (!photoBtn || !videoBtn || !musicBtn || !clearBtn) return;

    // Reset all buttons to default state
    photoBtn.classList.remove('btn-success');
    photoBtn.classList.add('btn-outline-secondary');
    videoBtn.classList.remove('btn-success');
    videoBtn.classList.add('btn-outline-secondary');
    musicBtn.classList.remove('btn-success');
    musicBtn.classList.add('btn-outline-secondary');

    // Update button text to default
    photoBtn.innerHTML = '<i class="bi bi-image"></i> Photo';
    videoBtn.innerHTML = '<i class="bi bi-play-circle"></i> Video';
    musicBtn.innerHTML = '<i class="bi bi-music-note"></i> Music';

    // Hide clear button by default
    clearBtn.style.display = 'none';

    // Highlight the appropriate button if media is attached
    if (attachedMedia) {
        // Show clear button when attachment exists
        clearBtn.style.display = 'inline-block';

        if (attachedMedia.type === 'image') {
            photoBtn.classList.remove('btn-outline-secondary');
            photoBtn.classList.add('btn-success');
            photoBtn.innerHTML = '<i class="bi bi-check-circle"></i> Photo Attached';
        } else if (attachedMedia.type === 'video') {
            videoBtn.classList.remove('btn-outline-secondary');
            videoBtn.classList.add('btn-success');
            videoBtn.innerHTML = '<i class="bi bi-check-circle"></i> Video Attached';
        } else if (attachedMedia.type === 'music') {
            musicBtn.classList.remove('btn-outline-secondary');
            musicBtn.classList.add('btn-success');
            musicBtn.innerHTML = '<i class="bi bi-check-circle"></i> Music Attached';
        }
    }
}

function clearAttachment() {
    attachedMedia = null;
    updateAttachmentButtons();
    showToast('Attachment removed!', 'info');
}

function attachPhoto() {
    const modal = new bootstrap.Modal(document.getElementById('photoModal'));
    modal.show();
}

function attachVideo() {
    document.getElementById('mediaModalTitle').innerHTML = '<i class="bi bi-play-circle"></i> Attach Video';
    document.getElementById('mediaLabel').textContent = 'YouTube or Video URL';
    document.getElementById('mediaUrl').placeholder = 'https://youtube.com/watch?v=...';
    
    const modal = new bootstrap.Modal(document.getElementById('mediaModal'));
    modal.show();
}

function attachMusic() {
    document.getElementById('mediaModalTitle').innerHTML = '<i class="bi bi-music-note"></i> Attach Music';
    document.getElementById('mediaLabel').textContent = 'Spotify or Apple Music URL';
    document.getElementById('mediaUrl').placeholder = 'https://open.spotify.com/track/... or https://music.apple.com/us/album/...';
    
    const modal = new bootstrap.Modal(document.getElementById('mediaModal'));
    modal.show();
}

async function previewPhoto() {
    const file = document.getElementById('postPhoto').files[0];
    const preview = document.getElementById('photoPreview');
    const previewImage = document.getElementById('previewImage');
    
    if (file) {
        try {
            // Check file size (limit to 10MB)
            if (file.size > 10 * 1024 * 1024) {
                showNotification('Image too large. Please select an image under 10MB.', 'danger');
                return;
            }
            
            // Show image editor modal
            showImageEditor(file);
        } catch (error) {
            console.error('Error processing image:', error);
            showNotification('Failed to process image. Please try again.', 'danger');
            preview.style.display = 'none';
        }
    } else {
        preview.style.display = 'none';
        if (attachedMedia && attachedMedia.type === 'image') {
            attachedMedia = null;
            updateAttachmentButtons();
        }
    }
}

function previewProfileImage() {
    const file = document.getElementById('signUpImage').files[0];
    if (file) {
        // Check file size (warn if over 5MB before compression)
        if (file.size > 5 * 1024 * 1024) {
            showNotification('Large image detected. Compressing for optimal performance...', 'info', 2000);
        }
        
        // Preview the image
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('signUpImagePreview');
            if (preview) {
                preview.src = e.target.result;
                preview.style.display = 'block';
            }
        };
        reader.readAsDataURL(file);
        
        tfDebug('Profile image selected:', file.name, 'Size:', (file.size / 1024).toFixed(1) + 'KB');
    }
}

// Image resizing utility function
function resizeImage(file, maxWidth = 400, maxHeight = 400, quality = 0.8) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = function() {
            // Calculate new dimensions while maintaining aspect ratio
            let { width, height } = img;
            
            if (width > height) {
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = (width * maxHeight) / height;
                    height = maxHeight;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            
            // Draw and compress the image
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to blob with compression
            canvas.toBlob(resolve, 'image/jpeg', quality);
        };
        
        img.src = URL.createObjectURL(file);
    });
}

async function attachPhotoToPost() {
    const file = document.getElementById('postPhoto').files[0];
    if (file) {
        try {
            showNotification('Processing image...', 'info', 1000);
            
            // Resize image for posts (larger size allowed, but still compressed)
            const resizedBlob = await resizeImage(file, 800, 600, 0.85);
            
            // Convert resized image to base64 so it persists if saved to storage
            const reader = new FileReader();
            reader.onload = function(e) {
                attachedMedia = {
                    type: 'image',
                    url: e.target.result,
                    title: file.name
                };
                
                const sizeKB = (e.target.result.length * 0.75 / 1024).toFixed(1);
                tfDebug('Compressed post image size: ~' + sizeKB + 'KB');
                
                updateAttachmentButtons();
                const modalEl = document.getElementById('photoModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();
                showToast('Photo attached!', 'success');
            };
            reader.readAsDataURL(resizedBlob);
        } catch (error) {
            console.error('Image processing failed:', error);
            showNotification('Image processing failed. Please try a different image.', 'danger');
        }
    }
}

/* ===========================
   IMAGE EDITOR FUNCTIONALITY
   =========================== */

// Global variables for image editor
let currentImageFile = null;
let imageEditorCanvas = null;
let imageEditorCtx = null;
let editorImage = null;
let imageScale = 1;
let imageX = 0;
let imageY = 0;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let currentAspectRatio = 'free';
let targetWidth = 800;
let targetHeight = 600;

/**
 * Show the image editor modal with the selected file
 * @param {File} file - The image file to edit
 */
function showImageEditor(file) {
    currentImageFile = file;
    const modal = new bootstrap.Modal(document.getElementById('imageEditorModal'));
    
    // Initialize canvas
    imageEditorCanvas = document.getElementById('imageEditorCanvas');
    imageEditorCtx = imageEditorCanvas.getContext('2d');
    
    // Load image
    const reader = new FileReader();
    reader.onload = function(e) {
        editorImage = new Image();
        editorImage.onload = function() {
            initializeImageEditor();
            modal.show();
        };
        editorImage.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Initialize the image editor with the loaded image
 */
function initializeImageEditor() {
    const frame = document.getElementById('editorPreviewFrame');
    const frameWidth = frame.clientWidth - 4; // Account for border
    const frameHeight = frame.clientHeight - 4;
    
    // Set canvas size to frame size
    imageEditorCanvas.width = frameWidth;
    imageEditorCanvas.height = frameHeight;
    
    // Calculate fit-to-frame scale
    const scaleX = frameWidth / editorImage.width;
    const scaleY = frameHeight / editorImage.height;
    const fitScale = Math.min(scaleX, scaleY, 1);
    
    // Start with a scale that allows zooming out (85% of fit scale)
    imageScale = Math.max(fitScale * 0.85, 0.3);
    
    // Update zoom slider range to accommodate the image
    const zoomSlider = document.getElementById('zoomSlider');
    const minZoom = Math.min(0.2, fitScale * 0.5); // Allow zooming out to 20% or half the fit scale
    const maxZoom = Math.max(3, fitScale * 2); // Allow zooming in to 300% or double the fit scale
    
    zoomSlider.min = minZoom;
    zoomSlider.max = maxZoom;
    zoomSlider.value = imageScale;
    zoomSlider.step = 0.05; // Finer control
    
    // Center the image
    centerImage();
    
    // Set up event listeners
    setupImageEditorEvents();
    
    // Reset aspect ratio
    setAspectRatio('free');
    
    // Draw initial image
    drawImageOnCanvas();
}

/**
 * Set up mouse and touch event listeners for image manipulation
 */
function setupImageEditorEvents() {
    // Mouse events
    imageEditorCanvas.addEventListener('mousedown', startDrag);
    imageEditorCanvas.addEventListener('mousemove', drag);
    imageEditorCanvas.addEventListener('mouseup', endDrag);
    imageEditorCanvas.addEventListener('mouseleave', endDrag);
    
    // Touch events for mobile
    imageEditorCanvas.addEventListener('touchstart', handleTouch);
    imageEditorCanvas.addEventListener('touchmove', handleTouch);
    imageEditorCanvas.addEventListener('touchend', endDrag);
    
    // Prevent context menu
    imageEditorCanvas.addEventListener('contextmenu', e => e.preventDefault());
}

/**
 * Handle mouse/touch drag start
 */
function startDrag(e) {
    isDragging = true;
    const rect = imageEditorCanvas.getBoundingClientRect();
    lastMouseX = (e.clientX || e.touches[0].clientX) - rect.left;
    lastMouseY = (e.clientY || e.touches[0].clientY) - rect.top;
    imageEditorCanvas.style.cursor = 'grabbing';
}

/**
 * Handle mouse/touch drag
 */
function drag(e) {
    if (!isDragging) return;
    
    e.preventDefault();
    const rect = imageEditorCanvas.getBoundingClientRect();
    const currentX = (e.clientX || e.touches[0].clientX) - rect.left;
    const currentY = (e.clientY || e.touches[0].clientY) - rect.top;
    
    imageX += currentX - lastMouseX;
    imageY += currentY - lastMouseY;
    
    lastMouseX = currentX;
    lastMouseY = currentY;
    
    drawImageOnCanvas();
}

/**
 * Handle touch events
 */
function handleTouch(e) {
    e.preventDefault();
    if (e.type === 'touchstart') {
        startDrag(e);
    } else if (e.type === 'touchmove') {
        drag(e);
    }
}

/**
 * Handle drag end
 */
function endDrag() {
    isDragging = false;
    imageEditorCanvas.style.cursor = 'move';
}

/**
 * Draw the image on the canvas with current transformations
 */
function drawImageOnCanvas() {
    // Clear canvas
    imageEditorCtx.clearRect(0, 0, imageEditorCanvas.width, imageEditorCanvas.height);
    
    // Calculate scaled dimensions
    const scaledWidth = editorImage.width * imageScale;
    const scaledHeight = editorImage.height * imageScale;
    
    // Draw image
    imageEditorCtx.drawImage(
        editorImage,
        imageX,
        imageY,
        scaledWidth,
        scaledHeight
    );
}

/**
 * Set zoom level
 * @param {number} scale - New scale value
 */
function setZoom(scale) {
    imageScale = parseFloat(scale);
    drawImageOnCanvas();
}

/**
 * Adjust zoom by a delta amount
 * @param {number} delta - Amount to change zoom
 */
function adjustZoom(delta) {
    const zoomSlider = document.getElementById('zoomSlider');
    const minZoom = parseFloat(zoomSlider.min);
    const maxZoom = parseFloat(zoomSlider.max);
    
    const newScale = Math.max(minZoom, Math.min(maxZoom, imageScale + delta));
    imageScale = newScale;
    zoomSlider.value = newScale;
    drawImageOnCanvas();
}

/**
 * Center the image in the canvas
 */
function centerImage() {
    const scaledWidth = editorImage.width * imageScale;
    const scaledHeight = editorImage.height * imageScale;
    
    imageX = (imageEditorCanvas.width - scaledWidth) / 2;
    imageY = (imageEditorCanvas.height - scaledHeight) / 2;
    
    drawImageOnCanvas();
}

/**
 * Reset image editor to initial state
 */
function resetImageEditor() {
    const frame = document.getElementById('editorPreviewFrame');
    const frameWidth = frame.clientWidth - 4;
    const frameHeight = frame.clientHeight - 4;
    
    const scaleX = frameWidth / editorImage.width;
    const scaleY = frameHeight / editorImage.height;
    imageScale = Math.min(scaleX, scaleY, 1);
    
    document.getElementById('zoomSlider').value = imageScale;
    centerImage();
}

/**
 * Fit image to frame (reset to initial scale)
 */
function fitImageToFrame() {
    console.log('Fitting image to frame');
    if (!editorImage || !imageEditorCanvas) return;
    
    const canvas = imageEditorCanvas;
    const frameWidth = canvas.width;
    const frameHeight = canvas.height;
    
    // Calculate scale to fit image within frame
    const scaleX = frameWidth / editorImage.width;
    const scaleY = frameHeight / editorImage.height;
    const fitScale = Math.min(scaleX, scaleY, 1);
    
    console.log('Calculated fit scale:', fitScale);
    
    // Set to fit scale and center
    imageScale = fitScale;
    imageX = (canvas.width - editorImage.width * imageScale) / 2;
    imageY = (canvas.height - editorImage.height * imageScale) / 2;
    
    // Update zoom slider
    const zoomSlider = document.getElementById('zoomSlider');
    zoomSlider.value = imageScale;
    
    // Redraw canvas
    drawImageOnCanvas();
}

/**
 * Set aspect ratio for cropping
 * @param {string} ratio - Aspect ratio ('free', '1:1', '4:3', '16:9')
 */
function setAspectRatio(ratio) {
    currentAspectRatio = ratio;
    
    // Update button states
    document.querySelectorAll('[id^="aspect"]').forEach(btn => {
        btn.classList.remove('active', 'btn-primary');
        btn.classList.add('btn-outline-secondary');
    });
    
    let activeBtn;
    switch (ratio) {
        case '1:1':
            activeBtn = document.getElementById('aspectSquare');
            targetWidth = 600;
            targetHeight = 600;
            break;
        case '4:3':
            activeBtn = document.getElementById('aspect43');
            targetWidth = 800;
            targetHeight = 600;
            break;
        case '16:9':
            activeBtn = document.getElementById('aspect169');
            targetWidth = 800;
            targetHeight = 450;
            break;
        default:
            activeBtn = document.getElementById('aspectFree');
            targetWidth = 800;
            targetHeight = 600;
    }
    
    if (activeBtn) {
        activeBtn.classList.remove('btn-outline-secondary');
        activeBtn.classList.add('btn-primary', 'active');
    }
}

/**
 * Apply the image edit and use the result
 */
async function applyImageEdit() {
    try {
        showNotification('Processing image...', 'info', 1500);
        
        // Create a new canvas for the final output
        const outputCanvas = document.createElement('canvas');
        const outputCtx = outputCanvas.getContext('2d');
        
        // Set output dimensions based on aspect ratio
        outputCanvas.width = targetWidth;
        outputCanvas.height = targetHeight;
        
        // Calculate the crop area from the current view
        const scaledWidth = editorImage.width * imageScale;
        const scaledHeight = editorImage.height * imageScale;
        
        // Calculate what portion of the original image to use
        const cropX = Math.max(0, -imageX / imageScale);
        const cropY = Math.max(0, -imageY / imageScale);
        const cropWidth = Math.min(
            editorImage.width - cropX,
            imageEditorCanvas.width / imageScale
        );
        const cropHeight = Math.min(
            editorImage.height - cropY,
            imageEditorCanvas.height / imageScale
        );
        
        // Draw the cropped and scaled image to output canvas
        outputCtx.drawImage(
            editorImage,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, targetWidth, targetHeight
        );
        
        // Convert to blob
        outputCanvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const isEditMode = imageEditorCanvas.dataset.editMode === 'true';
                
                if (isEditMode) {
                    // Handle edit post mode
                    editAttachedMedia = {
                        type: 'image',
                        url: e.target.result,
                        title: currentImageFile.name
                    };
                    
                    // Show preview in edit modal
                    document.getElementById('editNewMediaPreview').innerHTML = `
                        <div class="p-3 bg-light rounded">
                            <strong>New Image:</strong><br>
                            <img src="${e.target.result}" alt="Preview" class="img-fluid rounded mt-2" style="max-height: 200px;">
                        </div>
                    `;
                    document.getElementById('editNewMediaPreview').style.display = 'block';
                    updateEditAttachmentButtons();
                } else {
                    // Handle new post mode
                    const preview = document.getElementById('photoPreview');
                    const previewImage = document.getElementById('previewImage');
                    previewImage.src = e.target.result;
                    preview.style.display = 'block';
                    
                    // Store the processed image
                    attachedMedia = {
                        type: 'image',
                        url: e.target.result,
                        title: currentImageFile.name
                    };
                    
                    updateAttachmentButtons();
                }
                
                showNotification('Image processed successfully!', 'success');
                
                // Close the image editor modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('imageEditorModal'));
                modal.hide();
                
                // Clear edit mode flag
                delete imageEditorCanvas.dataset.editMode;
            };
            reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.85);
        
    } catch (error) {
        console.error('Error applying image edit:', error);
        showNotification('Failed to process image. Please try again.', 'danger');
    }
}

function attachMediaToPost() {
    const url = document.getElementById('mediaUrl').value.trim();
    if (url) {
        const isVideo = url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com');
        const isSpotify = url.includes('spotify.com');
        const isAppleMusic = url.includes('music.apple.com');
        
        let mediaType = 'music';
        let embedUrl = url;
        
        if (isVideo) {
            mediaType = 'video';
            // Convert YouTube URL to embed format
            if (url.includes('youtube.com/watch?v=')) {
                const videoId = url.split('v=')[1].split('&')[0];
                embedUrl = `https://www.youtube.com/embed/${videoId}`;
            } else if (url.includes('youtu.be/')) {
                const videoId = url.split('youtu.be/')[1].split('?')[0];
                embedUrl = `https://www.youtube.com/embed/${videoId}`;
            }
        } else if (isSpotify) {
            // Convert Spotify URL to embed format
            if (url.includes('/track/')) {
                const trackId = url.split('/track/')[1].split('?')[0];
                embedUrl = `https://open.spotify.com/embed/track/${trackId}`;
            } else if (url.includes('/album/')) {
                const albumId = url.split('/album/')[1].split('?')[0];
                embedUrl = `https://open.spotify.com/embed/album/${albumId}`;
            } else if (url.includes('/playlist/')) {
                const playlistId = url.split('/playlist/')[1].split('?')[0];
                embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
            }
        } else if (isAppleMusic) {
            // Apple Music URL processing - convert to embed format
            const urlParts = url.split('?')[0]; // Remove query parameters
            
            if (url.includes('/album/')) {
                const albumMatch = urlParts.match(/\/album\/([^\/]+)\/(\d+)/);
                if (albumMatch) {
                    const albumId = albumMatch[2];
                    embedUrl = `https://embed.music.apple.com/us/album/${albumId}`;
                }
            } else if (url.includes('/song/')) {
                const songMatch = urlParts.match(/\/song\/([^\/]+)\/(\d+)/);
                if (songMatch) {
                    const songId = songMatch[2];
                    embedUrl = `https://embed.music.apple.com/us/song/${songId}`;
                }
            } else if (url.includes('/playlist/')) {
                const playlistMatch = urlParts.match(/\/playlist\/([^\/]+)\/(pl\.[^\/]+)/);
                if (playlistMatch) {
                    const playlistId = playlistMatch[2];
                    embedUrl = `https://embed.music.apple.com/us/playlist/${playlistId}`;
                }
            }
        }
        
        attachedMedia = {
            type: mediaType,
            url: url,
            embedUrl: embedUrl,
            title: `${isVideo ? 'Video' : isSpotify ? 'Spotify' : isAppleMusic ? 'Apple Music' : 'Music'} Link`,
            service: isVideo ? 'youtube' : isSpotify ? 'spotify' : isAppleMusic ? 'apple' : 'other'
        };
        
        updateAttachmentButtons();
        // Safely hide modal if instance exists
        const mediaModalEl = document.getElementById('mediaModal');
        const mediaModalInstance = mediaModalEl ? bootstrap.Modal.getInstance(mediaModalEl) : null;
        if (mediaModalInstance && typeof mediaModalInstance.hide === 'function') {
            mediaModalInstance.hide();
        }
        document.getElementById('mediaUrl').value = '';
        showToast(`${isVideo ? 'Video' : 'Music'} attached!`, 'success');
    }
}

// Search Functions
function performSearch() {
    const nameQuery = document.getElementById('searchByName').value.trim().toLowerCase();
    const interestQuery = document.getElementById('searchByInterest').value;
    
    if (!nameQuery && !interestQuery) {
        alert('Please enter a search term or select an interest.');
        return;
    }
    
    let results = [];
    
    if (nameQuery) {
        results = users.filter(user => 
            user.fullName.toLowerCase().includes(nameQuery) ||
            user.username.toLowerCase().includes(nameQuery)
        );
    }
    
    if (interestQuery) {
        const interestResults = users.filter(user => 
            user.interests.includes(interestQuery)
        );
        
        // Combine results and remove duplicates
        results = [...results, ...interestResults].filter((user, index, self) => 
            index === self.findIndex(u => u.id === user.id)
        );
    }
    
    bootstrap.Modal.getInstance(document.getElementById('searchModal')).hide();
    displaySearchResults(results, nameQuery || interestQuery);
}

function displaySearchResults(results, query) {
    hideAllPages();
    document.getElementById('searchPage').style.display = 'block';
    currentPage = 'search';
    
    const searchResults = document.getElementById('searchResults');
    
    if (results.length === 0) {
        searchResults.innerHTML = `
            <div class="text-center p-4 text-muted">
                <i class="bi bi-search fs-1 d-block mb-3"></i>
                <h5>No results found</h5>
                <p>No users found matching "${query}"</p>
                <button class="btn btn-primary" onclick="showDashboard()">Back to Dashboard</button>
            </div>
        `;
        return;
    }
    
    searchResults.innerHTML = `
        <div class="mb-3">
            <h6 class="text-muted">Found ${results.length} user(s) matching "${query}"</h6>
        </div>
    `;
    
    results.forEach(user => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        resultItem.onclick = () => showProfile(user.id);
        
        resultItem.innerHTML = `
            <img src="${user.avatar}" alt="${user.fullName}" class="search-result-avatar">
            <div class="flex-grow-1">
                <h6 class="mb-1">${user.fullName}</h6>
                <p class="text-muted mb-1">@${user.username}</p>
                <p class="text-secondary mb-0">
                    <i class="bi bi-geo-alt"></i> ${user.city}, ${user.state}, ${user.country}
                </p>
                <div class="mt-2">
                    ${user.interests.slice(0, 3).map(interest => 
                        `<span class="badge bg-light text-dark me-1">${interest}</span>`
                    ).join('')}
                    ${user.interests.length > 3 ? `<span class="text-muted">+${user.interests.length - 3} more</span>` : ''}
                </div>
            </div>
        `;
        
        searchResults.appendChild(resultItem);
    });
}

// Sidebar Functions
function showFriends() {
    if (!currentUser || !currentUser.friends || currentUser.friends.length === 0) {
        updateSidebarContent('friends', 'Friends', `
            <div class="text-center p-4 text-muted">
                <i class="bi bi-people fs-1 d-block mb-3"></i>
                <h6>Your Friends</h6>
                <p>Connect with other users to see them here!</p>
            </div>
        `);
        return;
    }
    
    let friendsHTML = '<div class="friends-list">';
    
    currentUser.friends.forEach(friendId => {
        const friend = users.find(u => u.id === friendId);
        if (friend) {
            friendsHTML += `
                <div class="friend-item border rounded p-3 mb-3 cursor-pointer" onclick="showProfile(${friendId})">
                    <div class="d-flex align-items-center">
                        <img src="${friend.avatar}" alt="${friend.fullName}" 
                             class="rounded-circle me-3" style="width:50px;height:50px;object-fit:cover;">
                        <div class="flex-grow-1">
                            <h6 class="mb-1">${friend.fullName}</h6>
                            <small class="text-muted">@${friend.username}</small>
                            <div class="mt-1">
                                <small class="text-info">${friend.city}, ${friend.state}</small>
                            </div>
                        </div>
                        <div class="text-end">
                            <button class="btn btn-outline-primary btn-sm me-2" onclick="event.stopPropagation(); checkAuthAndMessage(${friendId})">
                                <i class="bi bi-chat"></i>
                            </button>
                            <i class="bi bi-chevron-right text-muted"></i>
                        </div>
                    </div>
                </div>
            `;
        }
    });
    
    friendsHTML += '</div>';
    
    updateSidebarContent('friends', 'Friends', friendsHTML);
}

function showRequests() {
    if (!currentUser || !currentUser.friendRequests || currentUser.friendRequests.length === 0) {
        updateSidebarContent('requests', 'Friend Requests', `
            <div class="text-center p-4 text-muted">
                <i class="bi bi-person-plus fs-1 d-block mb-3"></i>
                <h6>Friend Requests</h6>
                <p>No new friend requests.</p>
            </div>
        `);
        return;
    }
    
    let requestsHTML = '<div class="friend-requests-list">';
    
    currentUser.friendRequests.forEach(requesterId => {
        const requester = users.find(u => u.id === requesterId);
        if (requester) {
            requestsHTML += `
                <div class="friend-request-item border rounded p-3 mb-3">
                    <div class="d-flex align-items-center">
                        <img src="${requester.avatar}" alt="${requester.fullName}" 
                             class="rounded-circle me-3" style="width:50px;height:50px;object-fit:cover;">
                        <div class="flex-grow-1">
                            <h6 class="mb-1">${requester.fullName}</h6>
                            <small class="text-muted">@${requester.username}</small>
                        </div>
                    </div>
                    <div class="mt-3">
                        <button class="btn btn-success btn-sm me-2" onclick="acceptFriendRequest(${requesterId})">
                            <i class="bi bi-check"></i> Accept
                        </button>
                        <button class="btn btn-outline-danger btn-sm" onclick="declineFriendRequest(${requesterId})">
                            <i class="bi bi-x"></i> Decline
                        </button>
                    </div>
                </div>
            `;
        }
    });
    
    requestsHTML += '</div>';
    
    updateSidebarContent('requests', 'Friend Requests', requestsHTML);
}

function showMessages() {
    if (!currentUser) {
        showNotification('Please sign in to view messages.', 'info');
        return;
    }
    
    if (!currentUser.messages || currentUser.messages.length === 0) {
        updateSidebarContent('messages', 'Messages', `
            <div class="text-center p-4 text-muted">
                <i class="bi bi-chat fs-1 d-block mb-3"></i>
                <h6>Messages</h6>
                <p>No conversations yet. Start chatting with your friends!</p>
            </div>
        `);
        return;
    }
    
    let messagesHTML = '<div class="message-threads-list">';
    
    currentUser.messages.forEach(contactId => {
        const contact = users.find(u => u.id === contactId);
        if (contact) {
            messagesHTML += `
                <div class="message-thread-item border rounded p-3 mb-3 cursor-pointer" onclick="openMessageThread(${contactId})">
                    <div class="d-flex align-items-center">
                        <img src="${contact.avatar}" alt="${contact.fullName}" 
                             class="rounded-circle me-3" style="width:40px;height:40px;object-fit:cover;">
                        <div class="flex-grow-1">
                            <h6 class="mb-1">${contact.fullName}</h6>
                            <small class="text-muted">Click to open conversation</small>
                        </div>
                        <div class="text-end">
                            <i class="bi bi-chevron-right text-muted"></i>
                        </div>
                    </div>
                </div>
            `;
        }
    });
    
    messagesHTML += '</div>';
    
    updateSidebarContent('messages', 'Messages', messagesHTML);
}

function openMessageThread(contactId) {
    // Check if user is signed in
    if (!currentUser) {
        showNotification('Please sign in to send messages.', 'info');
        return;
    }
    
    const contact = users.find(u => u.id === contactId);
    if (!contact) return;
    
    // Create conversation ID
    const conversationId = currentUser.id < contactId ? `${currentUser.id}_${contactId}` : `${contactId}_${currentUser.id}`;
    const conversation = messages[conversationId] || [];
    
    // Mark all messages from this contact as read
    conversation.forEach(msg => {
        if (msg.senderId === contactId) {
            msg.read = true;
        }
    });
    
    // Save data and update counts
    saveDataToStorage();
    updateDashboardCounts();
    
    // Build messages HTML
    let messagesHTML = '';
    
    if (conversation.length === 0) {
        messagesHTML = `
            <div class="text-center text-muted">
                <i class="bi bi-chat-dots"></i>
                <p class="mt-2 mb-0">Start your conversation with ${contact.fullName}</p>
            </div>
        `;
    } else {
        conversation.forEach(msg => {
            const isFromCurrentUser = msg.senderId === currentUser.id;
            const messageTime = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            messagesHTML += `
                <div class="message-bubble ${isFromCurrentUser ? 'message-sent' : 'message-received'} mb-2">
                    <div class="message-content p-2 rounded">
                        ${msg.content}
                    </div>
                    <small class="message-time text-muted">${messageTime}</small>
                </div>
            `;
        });
    }
    
    // Show the message interface
    updateSidebarContent('messages', `Chat with ${contact.fullName}`, `
        <div class="message-thread">
            <div class="d-flex align-items-center mb-3 pb-3 border-bottom">
                <img src="${contact.avatar}" alt="${contact.fullName}" 
                     class="rounded-circle me-3" style="width:40px;height:40px;object-fit:cover;">
                <div>
                    <h6 class="mb-0">${contact.fullName}</h6>
                    <small class="text-muted">@${contact.username}</small>
                </div>
            </div>
            
            <div class="messages-container mb-3" id="messagesContainer" style="height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px; padding: 1rem;">
                ${messagesHTML}
            </div>
            
            <div class="message-input">
                <div class="input-group">
                    <input type="text" class="form-control" placeholder="Type a message..." id="messageInput" onkeypress="if(event.key==='Enter') sendMessage(${contactId})">
                    <button class="btn btn-primary" onclick="sendMessage(${contactId})">
                        <i class="bi bi-send"></i>
                    </button>
                </div>
            </div>
            
            <button class="btn btn-outline-secondary btn-sm mt-3" onclick="showMessages()">
                <i class="bi bi-arrow-left"></i> Back to Messages
            </button>
        </div>
    `);
    
    // Auto-scroll to bottom of messages
    setTimeout(() => {
        const container = document.getElementById('messagesContainer');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, 100);
}

function sendMessage(contactId) {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!currentUser) {
        showNotification('Please sign in to send messages.', 'info');
        return;
    }
    
    if (!message) return;
    
    // Create conversation ID (smaller ID first for consistency)
    const conversationId = currentUser.id < contactId ? `${currentUser.id}_${contactId}` : `${contactId}_${currentUser.id}`;
    
    // Initialize conversation if it doesn't exist
    if (!messages[conversationId]) {
        messages[conversationId] = [];
    }
    
    // Add message to conversation
    const newMessage = {
        id: Date.now(),
        senderId: currentUser.id,
        receiverId: contactId,
        content: message,
        timestamp: new Date(),
        read: false
    };
    
    messages[conversationId].push(newMessage);
    
    // Add contact to both users' message lists if not already there
    if (!currentUser.messages) currentUser.messages = [];
    if (!currentUser.messages.includes(contactId)) {
        currentUser.messages.push(contactId);
    }
    
    const contact = users.find(u => u.id === contactId);
    if (contact) {
        if (!contact.messages) contact.messages = [];
        if (!contact.messages.includes(currentUser.id)) {
            contact.messages.push(currentUser.id);
        }
    }
    
    // Save data and update UI
    saveDataToStorage();
    updateDashboardCounts();
    
    // Clear input and refresh the conversation view
    messageInput.value = '';
    openMessageThread(contactId);
    
    // Show success notification
    showNotification('Message sent!', 'success', 2000);
}

function updateSidebarContent(type, title, content) {
    const sidebarContent = document.getElementById('sidebarContent');
    
    // If the same modal is already open, close it
    if (currentOpenModal === type) {
        sidebarContent.innerHTML = '';
        currentOpenModal = null;
        return;
    }
    
    // Set the current open modal
    currentOpenModal = type;
    
    sidebarContent.innerHTML = `
        <div class="card shadow-sm">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h6 class="mb-0">${title}</h6>
                <button type="button" class="btn-close btn-close-white" aria-label="Close" onclick="closeSidebarModal()"></button>
            </div>
            <div class="card-body">
                ${content}
            </div>
        </div>
    `;
}

function closeSidebarModal() {
    const sidebarContent = document.getElementById('sidebarContent');
    sidebarContent.innerHTML = '';
    currentOpenModal = null;
}

function editProfile() {
    if (!currentUser) return;
    
    // Pre-populate form with current user data
    document.getElementById('editFullName').value = currentUser.fullName;
    document.getElementById('editUsername').value = currentUser.username;
    document.getElementById('editEmail').value = currentUser.email;
    document.getElementById('editCity').value = currentUser.city;
    document.getElementById('editState').value = currentUser.state;
    document.getElementById('editCountry').value = currentUser.country;
    
    const aboutMeField = document.getElementById('editAboutMe');
    aboutMeField.value = currentUser.aboutMe || '';
    
    // Set up character counter for About Me
    updateAboutMeCounter();
    aboutMeField.addEventListener('input', updateAboutMeCounter);
    
    // Reset password section
    document.getElementById('changePasswordCheck').checked = false;
    document.getElementById('passwordSection').style.display = 'none';
    document.getElementById('editCurrentPassword').value = '';
    document.getElementById('editNewPassword').value = '';
    
    // Pre-select interests
    selectedInterests = [...currentUser.interests];
    populateEditInterests();
    
    // Show the Edit Profile modal
    const modal = new bootstrap.Modal(document.getElementById('editProfileModal'));
    modal.show();
}

// Utility Functions
function getTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInSeconds = Math.floor((now - time) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return time.toLocaleDateString();
}

// Deprecated: showToast now delegates to showNotification for unified styling
function showToast(message, type = 'info') {
    // For backward compatibility, map success/info/danger through to showNotification
    showNotification(message, type === 'success' ? 'success' : type, 3000);
}

function saveDataToStorage() {
    try {
        // Defensive: ensure critical collections exist to avoid aborting the whole save operation
        if (!Array.isArray(users)) users = [];
        if (!Array.isArray(posts)) posts = [];
        if (typeof messages !== 'object' || messages === null) messages = {};
        if (typeof userNewsSubscriptions !== 'object' || userNewsSubscriptions === null) userNewsSubscriptions = {};

        localStorage.setItem('truefew_users', JSON.stringify(users));
        localStorage.setItem('truefew_posts', JSON.stringify(posts));
        localStorage.setItem('truefew_messages', JSON.stringify(messages));
        localStorage.setItem('truefew_news_subscriptions', JSON.stringify(userNewsSubscriptions));
        if (currentUser) {
            localStorage.setItem('truefew_current_user', JSON.stringify(currentUser));
        }
    } catch (e) {
        // Never let a storage error break posting or UI flow
        console.warn('saveDataToStorage failed:', e);
        try { tfDebug('saveDataToStorage error', e.message); } catch(_){}
    }
}

// Elegant Notification System
function showNotification(message, type = 'success', duration = 3000) {
    // Remove existing notification if any
    const existingNotification = document.querySelector('.custom-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Check if this is an authentication warning
    const isAuthWarning = message.toLowerCase().includes('sign in') || 
                         message.toLowerCase().includes('please sign') ||
                         message.toLowerCase().includes('authentication') ||
                         message.toLowerCase().includes('sign up') ||
                         message.toLowerCase().includes('log in') ||
                         message.toLowerCase().includes('login');
    
    // Create notification element
    const notification = document.createElement('div');
    let notificationClass = `custom-notification alert alert-${type} alert-dismissible`;
    if (isAuthWarning) {
        notificationClass += ' auth-warning';
    }
    notification.className = notificationClass;
    
    // Use slide down animation for auth warnings, slide right for others
    const animationIn = isAuthWarning ? 'slideInDown' : 'slideInRight';
    const animationOut = isAuthWarning ? 'slideOutUp' : 'slideOutRight';
    
    // Position: center top for auth warnings, top right for others
    const positionStyles = isAuthWarning ? `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        min-width: 350px;
        max-width: 500px;
        margin: 0;
    ` : `
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 9999;
        min-width: 300px;
    `;
    
    notification.style.cssText = `
        ${positionStyles}
        border-radius: 10px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.2);
        animation: ${animationIn} 0.4s ease-out;
        animation-fill-mode: both;
    `;
    
    notification.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="bi bi-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
            <span>${message}</span>
            <button type="button" class="btn-close ms-auto" onclick="this.parentElement.parentElement.remove()"></button>
        </div>
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto remove after duration
    setTimeout(() => {
        if (notification && notification.parentNode) {
            notification.style.animation = `${animationOut} 0.3s ease-in`;
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }
    }, duration);
}

// Helper function to count unread messages for current user
function getUnreadMessagesCount() {
    if (!currentUser || !currentUser.messages) return 0;
    
    let unreadCount = 0;
    
    currentUser.messages.forEach(contactId => {
        const conversationId = currentUser.id < contactId ? `${currentUser.id}_${contactId}` : `${contactId}_${currentUser.id}`;
        const conversation = messages[conversationId] || [];
        
        // Count messages from the contact that are unread
        conversation.forEach(msg => {
            if (msg.senderId === contactId && !msg.read) {
                unreadCount++;
            }
        });
    });
    
    return unreadCount;
}

// Helper function to check authentication before messaging
function checkAuthAndMessage(contactId) {
    if (!currentUser) {
        showNotification('Please sign in to send messages.', 'info');
        return;
    }
    
    openMessageThread(contactId);
}

// Load posts from storage
function loadFromStorage() {
    const savedPosts = localStorage.getItem('truefew_posts');
    if (savedPosts) {
        posts = JSON.parse(savedPosts);
    }
}

// News Feed Functions
function shareNewsAsPost(title, url, source) {
    if (!currentUser) {
        showSignInModal();
        return;
    }
    
    const content = `📰 ${decodeURIComponent(title)}\n\nSource: ${source}\nRead more: ${url}`;
    
    const newPost = {
        id: posts.length + 1,
        authorId: currentUser.id,
        content: content,
        timestamp: new Date(),
        likes: [],
        comments: [],
        shares: 0,
        media: {
            type: 'news',
            url: url,
            title: decodeURIComponent(title),
            source: source
        }
    };
    
    posts.push(newPost);
    saveDataToStorage();
    loadPostsFeed();
    
    showToast('News article shared as post!', 'success');
}

function unfollowNewsSource(interest) {
    if (!currentUser) return;
    
    // Initialize if doesn't exist
    if (!userNewsSubscriptions[currentUser.id]) {
        userNewsSubscriptions[currentUser.id] = [...currentUser.interests];
    }
    
    const userSources = userNewsSubscriptions[currentUser.id];
    const index = userSources.indexOf(interest);
    
    if (index > -1) {
        userSources.splice(index, 1);
        saveDataToStorage();
        loadNewsFeed();
        showToast(`Unfollowed ${interest} news`, 'info');
    }
}

function followNewsSource(interest) {
    if (!currentUser) return;
    
    // Initialize if doesn't exist
    if (!userNewsSubscriptions[currentUser.id]) {
        userNewsSubscriptions[currentUser.id] = [...currentUser.interests];
    }
    
    const userSources = userNewsSubscriptions[currentUser.id];
    
    if (!userSources.includes(interest)) {
        userSources.push(interest);
        saveDataToStorage();
        loadNewsFeed();
        showToast(`Now following ${interest} news`, 'success');
    }
}

// Password Visibility Toggle Function
function togglePasswordVisibility(passwordFieldId, toggleButtonId) {
    const passwordField = document.getElementById(passwordFieldId);
    const toggleButton = document.getElementById(toggleButtonId);
    const icon = toggleButton.querySelector('i');
    
    if (passwordField.type === 'password') {
        passwordField.type = 'text';
        icon.className = 'bi bi-eye-slash';
        toggleButton.setAttribute('title', 'Hide password');
    } else {
        passwordField.type = 'password';
        icon.className = 'bi bi-eye';
        toggleButton.setAttribute('title', 'Show password');
    }
}

// Edit Profile Functions
function togglePasswordSection() {
    const checkbox = document.getElementById('changePasswordCheck');
    const passwordSection = document.getElementById('passwordSection');
    
    if (checkbox.checked) {
        passwordSection.style.display = 'block';
    } else {
        passwordSection.style.display = 'none';
        // Clear password fields when hiding
        document.getElementById('editCurrentPassword').value = '';
        document.getElementById('editNewPassword').value = '';
    }
}

/**
 * Update About Me character counter
 */
function updateAboutMeCounter() {
    const aboutMeField = document.getElementById('editAboutMe');
    const counter = document.getElementById('aboutMeCounter');
    
    if (aboutMeField && counter) {
        const currentLength = aboutMeField.value.length;
        counter.textContent = `${currentLength}/500`;
        
        // Change color based on character count
        if (currentLength > 450) {
            counter.className = 'text-warning';
        } else if (currentLength === 500) {
            counter.className = 'text-danger';
        } else {
            counter.className = 'text-muted';
        }
    }
}

function populateEditInterests() {
    const grid = document.getElementById('editInterestsGrid');
    grid.innerHTML = '';
    grid.className = 'row g-2 interests-form-section';
    
    availableInterests.forEach((interest, index) => {
        const colDiv = document.createElement('div');
        colDiv.className = 'col-md-6 col-lg-4';
        
        const isChecked = selectedInterests.includes(interest);
        
        colDiv.innerHTML = `
            <div class="form-check">
                <input type="checkbox" class="form-check-input" id="edit_interest_${index}" value="${interest}" 
                       onchange="toggleEditInterest('${interest}')" ${isChecked ? 'checked' : ''}>
                <label class="form-check-label" for="edit_interest_${index}">
                    ${interest}
                </label>
            </div>
        `;
        
        grid.appendChild(colDiv);
    });
}

function toggleEditInterest(interest) {
    const index = selectedInterests.indexOf(interest);
    const errorDiv = document.getElementById('editInterestError');
    const successDiv = document.getElementById('editInterestSuccess');
    
    if (index > -1) {
        selectedInterests.splice(index, 1);
    } else {
        selectedInterests.push(interest);
    }
    
    // Update error/success messages
    if (selectedInterests.length < 8) {
        errorDiv.textContent = `Please select ${8 - selectedInterests.length} more interest(s). You can select as many as you like, but at least 8 are required.`;
        errorDiv.style.display = 'block';
        successDiv.style.display = 'none';
    } else {
        errorDiv.style.display = 'none';
        successDiv.textContent = 'Sharing your interests allows us to help connect you with people who share your style.';
        successDiv.style.display = 'block';
    }
}

async function submitEditProfile() {
    if (!currentUser) return;
    
    const fullName = document.getElementById('editFullName').value.trim();
    const username = document.getElementById('editUsername').value.trim();
    const email = document.getElementById('editEmail').value.trim();
    const city = document.getElementById('editCity').value.trim();
    const state = document.getElementById('editState').value.trim();
    const country = document.getElementById('editCountry').value.trim();
    const aboutMe = document.getElementById('editAboutMe').value.trim();
    const imageFile = document.getElementById('editProfileImage').files[0];
    
    const changePassword = document.getElementById('changePasswordCheck').checked;
    const currentPassword = document.getElementById('editCurrentPassword').value;
    const newPassword = document.getElementById('editNewPassword').value;
    
    // Validation
    if (!fullName || !username || !email || !city || !state || !country) {
        alert('Please fill in all required fields.');
        return;
    }
    
    // Validate About Me character limit
    if (aboutMe.length > 500) {
        alert('About Me section must be 500 characters or less.');
        return;
    }
    
    if (selectedInterests.length < 8) {
        document.getElementById('editInterestError').textContent = 'Please select at least 8 interests.';
        document.getElementById('editInterestError').style.display = 'block';
        return;
    }
    
    // Debug: Log current user info and form values
    console.log('Edit Profile Validation Debug:', {
        currentUser: { id: currentUser.id, uid: currentUser.uid, username: currentUser.username, email: currentUser.email },
        formValues: { username, email },
        usersArrayLength: users.length
    });
    
    // Check if username or email is taken by another user
    const normalizedUsername = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();
    
    // Check both uid and id fields to handle Firebase/local user mismatches
    const existingUser = users.find(u => {
        const isCurrentUser = (u.id === currentUser.id) || 
                             (u.uid === currentUser.uid) || 
                             (currentUser.uid && u.id === currentUser.uid) ||
                             (currentUser.id && u.uid === currentUser.id);
        
        if (isCurrentUser) return false; // Skip current user
        
        const userUsername = (u.username || '').toLowerCase();
        const userEmail = (u.email || '').toLowerCase();
        
        return (userUsername === normalizedUsername) || (userEmail === normalizedEmail);
    });
    
    if (existingUser) {
        console.error('Profile edit validation failed:', { 
            conflictUser: { id: existingUser.id, uid: existingUser.uid, username: existingUser.username, email: existingUser.email },
            currentUser: { id: currentUser.id, uid: currentUser.uid, username: currentUser.username, email: currentUser.email },
            formData: { username, email }
        });
        alert('Username or email is already taken by another user.');
        return;
    }
    
    // Handle password change if requested
    if (changePassword) {
        if (!currentPassword || !newPassword) {
            alert('Please fill in both current and new password fields.');
            return;
        }
        
        // Verify current password
        if (currentUser.password !== hashPassword(currentPassword)) {
            alert('Current password is incorrect.');
            return;
        }
        
        if (!validatePassword(newPassword)) {
            alert('New password must be at least 8 characters with uppercase, lowercase, and number.');
            return;
        }
        
        // Update password\n        currentUser.password = hashPassword(newPassword);
    }
    
    // Update user data
    currentUser.fullName = fullName;
    currentUser.username = username;
    currentUser.email = email;
    currentUser.city = city;
    currentUser.state = state;
    currentUser.country = country;
    currentUser.aboutMe = aboutMe;
    currentUser.interests = [...selectedInterests];
    if (!currentUser.id && currentUser.uid) currentUser.id = currentUser.uid;
    
    // Update avatar if new image was selected
    if (imageFile) {
        try {
            showNotification('Processing profile image...', 'info', 1500);
            
            // Resize image to reduce storage size
            const resizedBlob = await resizeImage(imageFile, 400, 400, 0.8);
            
            // Convert resized image to base64 for persistent storage
            const reader = new FileReader();
            reader.onload = function(e) {
                const result = e.target.result;
                if (typeof result === 'string' && result.startsWith('data:')) {
                    currentUser.avatar = result;
                    const sizeKB = (result.length * 0.75 / 1024).toFixed(1); // Rough base64 size estimate
                    tfDebug('Compressed avatar size: ~' + sizeKB + 'KB');
                } else {
                    console.warn('Edit profile avatar did not return data URL; keeping previous avatar');
                }
                
                // Update the user in the users array
                const userIndex = users.findIndex(u => u.id === currentUser.id);
                if (userIndex !== -1) {
                    users[userIndex] = { ...currentUser };
                }
                
                // Save to storage
                saveDataToStorage();
                
                // Sync to Firestore if authenticated
                if (currentUser.uid && typeof db !== 'undefined') {
                    (async () => {
                        try {
                            await db.collection('users').doc(currentUser.uid).update({
                                fullName: currentUser.fullName,
                                username: currentUser.username,
                                email: currentUser.email,
                                city: currentUser.city,
                                state: currentUser.state,
                                country: currentUser.country,
                                aboutMe: currentUser.aboutMe,
                                interests: currentUser.interests,
                                avatar: currentUser.avatar,
                                updatedAt: new Date().toISOString()
                            });
                        } catch (err) {
                            console.error('❌ Firestore update failed (image path):', err);
                            showNotification('Profile saved locally. Cloud sync failed.', 'warning');
                        }
                    })();
                }
                // Update UI
                updateNavbarForSignedInUser();
                updateDashboardContent();
                
                // Close modal
                bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
                
                // Show success message
                showToast('Profile updated successfully!', 'success');
                
                // Refresh current page
                if (currentPage === 'dashboard') {
                    showDashboard();
                } else if (currentPage === 'profile') {
                    showProfile('current');
                }
            };
            reader.readAsDataURL(resizedBlob);
            return; // Exit here to let the FileReader handle the rest
        } catch (error) {
            console.error('Image processing failed:', error);
            showNotification('Image processing failed. Keeping current avatar.', 'warning');
            // Continue with profile update without changing avatar
        }
    }
    
    // Handle normal profile update without image
    // Update the user in the users array
    const userIndex = users.findIndex(u => u.id === currentUser.id);
    if (userIndex !== -1) {
        // Guard: never persist blob: avatar if one somehow slipped into currentUser
        if (currentUser.avatar && currentUser.avatar.startsWith('blob:')) {
            console.warn('Stripping blob: avatar during profile save (no change applied)');
            delete currentUser.avatar; // forces client to regenerate or keep old stored version
        }
        users[userIndex] = { ...currentUser };
    }
    
    // Save to storage
    saveDataToStorage();
    if (currentUser.uid && typeof db !== 'undefined') {
        (async () => {
            try {
                await db.collection('users').doc(currentUser.uid).update({
                    fullName: currentUser.fullName,
                    username: currentUser.username,
                    email: currentUser.email,
                    city: currentUser.city,
                    state: currentUser.state,
                    country: currentUser.country,
                    aboutMe: currentUser.aboutMe,
                    interests: currentUser.interests,
                    updatedAt: new Date().toISOString()
                });
                console.log('✅ Firestore profile updated (no image path)');
            } catch (err) {
                console.error('❌ Firestore update failed (no image path):', err);
                showNotification('Profile saved locally. Cloud sync failed.', 'warning');
            }
        })();
    }
    
    // Update UI
    updateNavbarForSignedInUser();
    updateDashboardContent();
    
    // Close modal
    bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
    
    // Show success message
    showToast('Profile updated successfully!', 'success');
    
    // Refresh current page
    if (currentPage === 'dashboard') {
        showDashboard();
    } else if (currentPage === 'profile') {
        showProfile('current');
    }
}

// ---------------------------------------------------------------------------
// Backward Compatibility Wrapper
// Some older cached script versions or inline debug helpers may still invoke
// updateNavbar(). Provide a safe wrapper that delegates to the new explicit
// functions to eliminate ReferenceError crashes in FileReader callbacks.
// ---------------------------------------------------------------------------
if (typeof window.updateNavbar === 'undefined') {
    window.updateNavbar = function() {
        try {
            if (currentUser && typeof updateNavbarForSignedInUser === 'function') {
                updateNavbarForSignedInUser();
            } else if (!currentUser && typeof updateNavbarForSignedOutUser === 'function') {
                updateNavbarForSignedOutUser();
            }
        } catch (err) {
            console.error('updateNavbar compatibility wrapper error:', err);
        }
    };
}

/* ===========================
   FIREBASE AUTHENTICATION STATE MANAGEMENT
   =========================== */

/**
 * Firebase Authentication State Observer
 * Automatically handles user login/logout state changes
 * Only allows access for verified users
 */
auth.onAuthStateChanged(async (user) => {
    tfDebug('Auth state changed:', user ? `User: ${user.email} (verified: ${user?.emailVerified})` : 'User signed out');
    
    if (user) {
        const isDevelopmentMode = localStorage.getItem('truefew_dev_mode') === 'true';
        
        if (user.emailVerified || isDevelopmentMode) {
            // User is signed in and email is verified (or dev mode active) - load profile
            if (isDevelopmentMode && !user.emailVerified) {
                console.warn('⚠️ DEVELOPMENT MODE: Auth state - email verification bypassed');
            }
            
            try {
                const userDoc = await db.collection('users').doc(user.uid).get();
                if (userDoc.exists) {
                    currentUser = { uid: user.uid, ...userDoc.data() };
                    // Normalize id + arrays for legacy local logic
                    if (!currentUser.id) currentUser.id = currentUser.uid;
                    currentUser.friends = Array.isArray(currentUser.friends) ? currentUser.friends : [];
                    currentUser.friendRequests = Array.isArray(currentUser.friendRequests) ? currentUser.friendRequests : [];
                    currentUser.messages = Array.isArray(currentUser.messages) ? currentUser.messages : [];
                    // Ensure current authenticated user exists in local users[] for feed resolution
                    ensureCurrentUserInUsersArray();
                    updateNavbarForSignedInUser();
                    

                    
                    tfDebug('User profile loaded:', currentUser.fullName);
                    
                    // Always check for navigation state to restore after user loads
                    console.log('🔄 Auth complete, checking navigation state...');
                    const restored = restoreNavigationState();
                    
                    if (!restored) {
                        // Only redirect to dashboard if no navigation state was restored
                        console.log('🔄 No navigation state restored, showing dashboard');
                        showDashboard();
                    } else {
                        console.log('🔄 Navigation state successfully restored');
                    }
                    
                    // Mark initial page load as complete after authentication is done
                    isInitialPageLoad = false;
                    console.log('🔄 Initial page load complete, flag reset');
                    
                    // Refresh feeds in case placeholder authors were used before auth resolved
                    try { if (typeof loadPostsFeed === 'function') loadPostsFeed(); } catch {}
                } else {
                    console.error('❌ User profile not found in Firestore');
                    await auth.signOut();
                }
            } catch (error) {
                console.error('❌ Error loading user profile:', error);
                await auth.signOut();
            }
        } else {
            // User is signed in but email is NOT verified (and not in dev mode)
            tfDebug('User email not verified, keeping signed out state');
            currentUser = null;
            updateNavbarForSignedOutUser();
            
            // Check if there's stored navigation state before redirecting to landing
            const storedState = getNavigationState();
            if (storedState.page && storedState.page !== 'landing') {
                console.log('🔄 Preserving stored navigation state during auth:', storedState);
                // Don't redirect to landing - keep stored state for later restoration
            } else if (currentPage !== 'landing') {
                showLanding();
            }
        }
    } else {
        // User is signed out
    tfDebug('User signed out');
        currentUser = null;
        updateNavbarForSignedOutUser();
        
        // Check if there's stored navigation state before redirecting to landing
        const storedState = getNavigationState();
        if (storedState.page && storedState.page !== 'landing') {
            console.log('🔄 Preserving stored navigation state during signout:', storedState);
            // Don't redirect to landing - keep stored state for later restoration
        } else if (currentPage !== 'landing') {
            showLanding();
        }
    }
});

// Ensure the authenticated Firestore user is represented in local users[] (used by feed rendering logic)
function ensureCurrentUserInUsersArray() {
    if (!currentUser) return;
    
    // Ensure currentUser has an id (use uid if id is missing)
    if (!currentUser.id && currentUser.uid) {
        currentUser.id = currentUser.uid;
    }
    
    if (!currentUser.id) {
        console.warn('currentUser has no id or uid, skipping users array insertion');
        return;
    }
    
    const existing = users.find(u => u.id === currentUser.id || (currentUser.uid && u.uid === currentUser.uid));
    if (!existing) {
        users.push({
            id: currentUser.id,
            uid: currentUser.uid,
            fullName: currentUser.fullName || currentUser.displayName || 'User',
            username: currentUser.username || (currentUser.email ? currentUser.email.split('@')[0] : `user_${currentUser.id}`),
            email: currentUser.email || '',
            avatar: currentUser.avatar || (typeof generateDefaultAvatar === 'function' ? generateDefaultAvatar(currentUser.fullName || 'U') : ''),
            city: currentUser.city || 'Unknown',
            state: currentUser.state || 'NA',
            country: currentUser.country || 'Unknown',
            interests: Array.isArray(currentUser.interests) ? currentUser.interests : [],
            friends: currentUser.friends || [],
            friendRequests: currentUser.friendRequests || [],
            messages: currentUser.messages || []
        });
        saveDataToStorage();
        tfDebug('Inserted current user into local users[] for feed consistency');
    }
}

/* ===========================
   APPLICATION INITIALIZATION
   =========================== */

// Duplicate DOMContentLoaded listener removed - using the one at line 213 instead

/**
 * Initialize UI components and event listeners
 */
function initializeUI() {
    // Lightweight init log (removed verbose diagnostics during cleanup pass)
    console.log(`Initializing UI (v${window.TRUEFEW_VERSION})`);
    // Populate interests in sign-up modal
    populateInterests();
    
    // Set up notification system
    // Guard: provide stub if real implementation not yet loaded
    if (typeof initializeNotifications === 'function') {
        initializeNotifications();
    } else {
        console.warn('initializeNotifications() not defined – using no-op stub');
    }
    
    // Tooltips are intentionally disabled (previous 3rd‑party lib removed for stability).
    // data-tippy-content attributes are converted to native title attributes in index.html.
    window.__TF_DISABLE_TOOLTIPS = true; // retained flag for future re‑enable toggle
    
    // Show landing page by default
    showLanding();
}

// (Removed duplicate late diagnostic block; early version now active.)

/* ===========================
   STUBS FOR MISSING INITIALIZERS (Hard Reload Safety)
   =========================== */
// Provide a graceful fallback if these functions weren't defined in earlier sections.
// NOTE: Use window.* assignment instead of block-scoped function declarations inside conditionals
// to guarantee availability across browsers (prevents ReferenceError on some engines after parsing).
if (typeof window.initializeNotifications !== 'function') {
    window.initializeNotifications = function() {
        if (!document.getElementById('tfNotificationContainer')) {
            const ctr = document.createElement('div');
            ctr.id = 'tfNotificationContainer';
            ctr.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:360px;';
            document.body.appendChild(ctr);
        }
        if (!window.__tfNotificationPatched) {
            window.__tfNotificationPatched = true;
            const original = window.showNotification;
            const queue = [];
            const MAX_ACTIVE = 4;
            function renderQueue() {
                const ctr = document.getElementById('tfNotificationContainer');
                if (!ctr) return;
                [...ctr.children].forEach(child => {
                    const id = child.getAttribute('data-id');
                    if (!queue.find(q => q.id === id && q.active)) child.remove();
                });
                queue.filter(q => q.active).forEach(item => {
                    if (!ctr.querySelector(`[data-id="${item.id}"]`)) {
                        const div = document.createElement('div');
                        div.className = `alert alert-${item.type}`;
                        div.style.cssText = 'margin:0;animation:fadeIn 0.25s ease-out';
                        div.setAttribute('data-id', item.id);
                        div.innerHTML = `<strong>${item.message}</strong>`;
                        ctr.appendChild(div);
                        setTimeout(() => { item.active = false; if (div.parentNode) div.remove(); }, item.duration);
                    }
                });
            }
            window.showNotification = function(message, type = 'success', duration = 3000) {
                try { original(message, type, duration); } catch {}
                const id = 'ntf_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                queue.push({ id, message, type, duration, active: true });
                const active = queue.filter(q => q.active);
                if (active.length > MAX_ACTIVE) {
                    const excess = active.length - MAX_ACTIVE;
                    active.slice(0, excess).forEach(e => e.active = false);
                }
                renderQueue();
            };
            console.log('🔔 Notification system initialized (enhanced queue, global assignment)');
        }
    };
}

if (typeof window.loadDemoData !== 'function') {
    window.loadDemoData = function() {
        if (typeof loadSampleData === 'function') {
            try { loadSampleData(); } catch (e) { console.warn('loadDemoData: loadSampleData failed', e); }
        }
        try {
            if (typeof loadPostsFeed === 'function') loadPostsFeed();
            if (typeof loadNewsFeed === 'function') loadNewsFeed();
        } catch (err) {
            console.warn('loadDemoData encountered an error while refreshing feeds:', err);
        }
        console.log('ℹ️ Demo data load pass complete');
    };
}

/* ===========================
   ANALYTICS INITIALIZATION (Guarded + Error Suppression)
   =========================== */
function initializeAnalytics() {
    if (window.__tfAnalyticsInitStarted) return; // idempotent
    window.__tfAnalyticsInitStarted = true;
    if (typeof firebase === 'undefined') { return; }
    if (typeof firebase.analytics === 'undefined') { console.log('ℹ️ Firebase analytics SDK not loaded (skipping).'); return; }
    try {
        firebase.analytics.isSupported().then(supported => {
            if (!supported) {
                console.log('ℹ️ Analytics not supported in this environment.');
                return;
            }
            try {
                firebase.analytics();
                suppressAnalyticsNetworkErrors();
                console.log('✅ Analytics initialized with suppression.');
            } catch (inner) {
                console.log('⚠️ Analytics init error (suppressed):', inner.message || inner);
            }
        }).catch(err => {
            console.log('⚠️ Analytics support check failed (ignored):', err.message || err);
        });
    } catch (err) {
        console.log('⚠️ Analytics outer init exception (ignored):', err.message || err);
    }
}

function suppressAnalyticsNetworkErrors() {
    if (window.__tfGASuppression) return;
    window.__tfGASuppression = true;
    // Patch fetch for GA g/collect failures (common with ad blockers)
    if (window.fetch) {
        const origFetch = window.fetch;
        window.fetch = function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (url.includes('google-analytics.com/g/collect')) {
                return origFetch.apply(this, args).catch(() => {
                    // Return a benign empty response so caller resolves without console error
                    return new Response(null, { status: 204, statusText: 'No Content (suppressed)' });
                });
            }
            return origFetch.apply(this, args);
        };
    }
    // Patch sendBeacon similarly
    if (navigator && navigator.sendBeacon) {
        const origBeacon = navigator.sendBeacon;
        navigator.sendBeacon = function(url, data) {
            try {
                return origBeacon.call(this, url, data);
            } catch (e) {
                if (url && url.includes('google-analytics.com/g/collect')) {
                    console.log('ℹ️ GA beacon blocked (suppressed).');
                    return true; // Pretend success
                }
                throw e;
            }
        };
    }
    console.log('🛡️ GA network error suppression active');
}

/* ===========================
   DIAGNOSTIC FALLBACK (Ensures showLastErrors exists)
   =========================== */
// Diagnostic fallback block removed during cleanup. If needed, reintroduce minimal
// helpers or inspect early capture in the dedicated diagnostics module.
