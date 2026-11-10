// ==========================================
// CAMPUSX - PRODUCTION READY (SUPABASE POWERED)
// ==========================================

// ==========================================
// CAMPUSX - PRODUCTION READY (SUPABASE POWERED)
// ==========================================

const SUPABASE_URL = 'https://lnggbqfrbcehuyjtlswn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vSKR8TL4AUzMQWJiiZoMfA_mFPMx9qP';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const DISAPPEARING_MODE = true;
const CONTENT_TTL_MS = 24 * 60 * 60 * 1000;
const CONTENT_EXPIRY_CHECK_INTERVAL_MS = 60 * 1000;
const expiredPostCleanupAttempts = new Set();

// Application live state synced with Supabase cloud
let data = {
  users: [],
  post: [],
  lost: [],
  messages: [],
  notifs: [],
  reports: []
};

let me = localStorage.getItem('campusUser');
let authMode = 'signup';
let toastTimer;
let chatWith = null;       
let category = 'All';      

// Announcements ticker data
const announcements = [
  { from: 'SRC PRESIDENT', text: 'INCOMING SRC WEEK PARTY AND DRINKS!!.' },
  { from: 'IT 2A COURSE REP', text: 'NEW BOOKS AVAILABLE.' },
  { from: 'IT 1A COURSE REP', text: 'PREPARE YOUR STUDENT ID CARD.' },
];

let videos = [
  { id: 1, by: 'Yaw Owusu', dept: 'Computer Eng', index: 'CE/22/014', skills: 'Video editing', desc: 'Sample video: upload your own!', src: '', likes: [], comments: [] }
];

// ==========================================
// INITIALIZATION & CLOUD DATA SYNC
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  const headerButtons = document.getElementById('header-buttons');
  if(headerButtons) renderHeader();

  const tickerText = document.getElementById('ticker-text');
  if(tickerText && announcements.length > 0){
    tickerText.textContent = announcements.map(a => `[${a.from}]: ${a.text}`).join('   ***   ');
  }

  if (DISAPPEARING_MODE) {
    const cleanupRequest = cleanupExpiredCloudPosts();
    const postsQuery = supabaseClient.from('posts').select('*').order('id', { ascending: false })
      .gte('id', Date.now() - CONTENT_TTL_MS);
    await loadCloudData(cleanupRequest, postsQuery);
  } else {
    await loadCloudData();
  }

  if (DISAPPEARING_MODE) {
    setInterval(expireDisappearingContent, CONTENT_EXPIRY_CHECK_INTERVAL_MS);
  }
});

async function loadCloudData(cleanupRequest, postsQuery) {
  try {
    // Fetch users, posts, lost & found from Supabase tables concurrently
    const [usersRes, postsRes, lostRes, notifsRes, reportsRes] = await Promise.all([
      supabaseClient.from('users').select('*'),
      postsQuery || supabaseClient.from('posts').select('*').order('id', { ascending: false }),
      supabaseClient.from('lost').select('*').order('id', { ascending: false }),
      supabaseClient.from('notifs').select('*'),
      supabaseClient.from('reports').select('*'),
      cleanupRequest || Promise.resolve()
    ]);

    let hasErrors = false;
    for (const [name, result] of Object.entries({
      users: usersRes,
      post: postsRes,
      lost: lostRes,
      notifs: notifsRes,
      reports: reportsRes
    })) {
      if (result.error) {
        console.error(`Could not load ${name}:`, result.error);
        hasErrors = true;
      } else {
        data[name] = result.data || [];
      }
    }

    // Validate active session user against fetched cloud users table
    if (!usersRes.error && me && !data.users.some(u => u.name === me)) {
      me = null;
      localStorage.removeItem('campusUser');
    }

    expireDisappearingContent();
    renderFeed();
    renderLost();
    renderHeader();
    if (hasErrors) showToast('Some campus data could not be loaded.');
  } catch (err) {
    console.error('Cloud synchronization error:', err);
    showToast('Failed to sync with cloud database.');
    renderFeed();
    renderLost();
    renderHeader();
  }
}

async function cleanupExpiredCloudPosts() {
  const cutoff = Date.now() - CONTENT_TTL_MS;
  try {
    const { data: candidates, error } = await supabaseClient
      .from('posts')
      .select('id')
      .lt('id', cutoff);
    if (error) {
      console.error('Could not find expired posts for cleanup:', error);
      showToast('Expired posts will be hidden, but cloud cleanup failed.');
      return;
    }

    const expiredPosts = (candidates || []).filter(post => isExpiredContent(post));
    if (expiredPosts.length > 0) await deleteExpiredPosts(expiredPosts);
  } catch (err) {
    console.error('Could not find expired posts for cleanup:', err);
    showToast('Expired posts will be hidden, but cloud cleanup failed.');
  }
}

function getContentCreatedAt(item) {
  const timestamp = item.created_at ?? item.createdAt ?? item.timestamp;
  if (timestamp !== undefined && timestamp !== null) {
    const numericTimestamp = Number(timestamp);
    if (Number.isFinite(numericTimestamp)) {
      return numericTimestamp < 1e12 ? numericTimestamp * 1000 : numericTimestamp;
    }
    const parsedTimestamp = Date.parse(timestamp);
    if (Number.isFinite(parsedTimestamp)) return parsedTimestamp;
  }

  // Existing posts use Date.now() as their database ID.
  const idTimestamp = Number(item.id);
  return Number.isFinite(idTimestamp) && idTimestamp >= 1e12 ? idTimestamp : null;
}

function isExpiredContent(item, now = Date.now()) {
  if (!DISAPPEARING_MODE) return false;
  const createdAt = getContentCreatedAt(item);
  return createdAt !== null && now - createdAt >= CONTENT_TTL_MS;
}

async function deleteExpiredPosts(posts) {
  const ids = posts
    .map(post => post.id)
    .filter(id => id !== undefined && id !== null && !expiredPostCleanupAttempts.has(id));
  if (ids.length === 0) return;

  ids.forEach(id => expiredPostCleanupAttempts.add(id));
  try {
    const { error } = await supabaseClient.from('posts').delete().in('id', ids);
    if (error) {
      console.error('Expired posts are hidden but could not be deleted from Supabase:', error);
      showToast('Expired posts are hidden, but cloud cleanup failed.');
    }
  } catch (err) {
    console.error('Expired posts are hidden but could not be deleted from Supabase:', err);
    showToast('Expired posts are hidden, but cloud cleanup failed.');
  }
}

function expireDisappearingContent() {
  if (!DISAPPEARING_MODE) return;

  const expiredPosts = data.post.filter(post => isExpiredContent(post));
  if (expiredPosts.length > 0) {
    const expiredIds = new Set(expiredPosts.map(post => post.id));
    data.post = data.post.filter(post => !expiredIds.has(post.id));
    renderFeed();
    void deleteExpiredPosts(expiredPosts);
  }

  const expiredVideos = videos.filter(video => isExpiredContent(video));
  if (expiredVideos.length > 0) {
    const expiredIds = new Set(expiredVideos.map(video => video.id));
    expiredVideos.forEach(video => {
      if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
    });
    videos = videos.filter(video => !expiredIds.has(video.id));
    if (document.getElementById('page-videos')?.classList.contains('active')) {
      renderVideos();
    }
  }
}

// Local storage replacement stub (kept empty or minimal since database handles persistence)
function save() {
  // Cloud database handles persistence automatically via Supabase inserts/updates
}

function showToast(message) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function requestText(title, placeholder, initialText, submitLabel) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('form');
    dialog.className = 'text-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'text-dialog-title');

    const heading = document.createElement('h2');
    heading.id = 'text-dialog-title';
    heading.textContent = title;
    const input = document.createElement('textarea');
    input.placeholder = placeholder;
    input.value = initialText || '';
    input.setAttribute('aria-label', placeholder);
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'small';
    cancel.textContent = 'Cancel';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn';
    submit.textContent = submitLabel || 'Post comment';

    actions.append(cancel, submit);
    dialog.append(heading, input, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const finish = value => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') finish(null);
    };
    document.addEventListener('keydown', onKeyDown);
    dialog.addEventListener('submit', event => {
      event.preventDefault();
      finish(input.value.trim() || null);
    });
    cancel.addEventListener('click', () => finish(null));
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) finish(null);
    });
    input.focus();
    if (initialText) input.select();
  });
}


// ==========================================
// AUTHENTICATION & CLOUD USER MANAGEMENT
// ==========================================
function toggleAuth(){
  const auth = document.getElementById('app-auth');
  auth.classList.toggle('active');
  if (auth.classList.contains('active')) {
    document.getElementById('a-name').focus();
  }
}

function showregister(mode){
  authMode = mode;
  document.getElementById('tab-signup').classList.toggle('on', mode === "signup");
  document.getElementById('tab-login').classList.toggle('on', mode === "login");
  document.getElementById('signup-fields').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('auth-button').textContent = mode === 'signup' ? 'Create Account' : 'Login';
  document.getElementById('auth-message').textContent = '';
}

async function submitform(){
  const name = document.getElementById('a-name').value.trim();
  const password = document.getElementById('a-password').value;
  const message = document.getElementById('auth-message');
  const button = document.getElementById('auth-button');
  
  if (!name || !password) {
    message.textContent = 'Please enter your name and password.';
    return; 
  }

  button.disabled = true;
  try {
    if (authMode === 'signup') {
      const existingUser = data.users.find(u => u.name === name);
      if(existingUser) {
        message.textContent = 'That name is already taken.';
        return;
      }
      
      const newUser = {
        name: name, 
        password: password,
        phone: document.getElementById('a-phone').value,
        dept: document.getElementById('a-dept').value,
        index: document.getElementById('a-index').value,
        gender: document.getElementById('a-gender').value,
        skills: document.getElementById('a-skills').value
      };

      const { error } = await supabaseClient.from('users').insert([newUser]);
      if (error) {
        console.error('Registration failed:', error);
        message.textContent = 'Registration failed. Please try again.';
        return;
      }
      data.users.push(newUser);
    } else {
      const user = data.users.find(u => u.name === name && u.password === password);
      if(!user) { 
        message.textContent = 'Account not found or password is incorrect.';
        return; 
      }
    }

    me = name;
    localStorage.setItem('campusUser', me);
    
    message.textContent = '';
    document.getElementById('app-auth').classList.remove('active');
    renderHeader();
    renderFeed();
    showToast(authMode === 'signup' ? 'Account created. Welcome to CAMPUS X!' : 'Welcome back, ' + name + '!');
  } catch (err) {
    console.error('Authentication request failed:', err);
    message.textContent = 'Could not connect to the server. Please try again.';
  } finally {
    button.disabled = false;
  }
}

function logout() {
  me = null;
  localStorage.removeItem('campusUser');
  renderHeader();
  showToast('Logged out successfully.');
}

function myUser() {
  return data.users.find(u => u.name === me) || { dept: 'Student', index: '', skills: '' };
}

function requiredlogin(){
  if(me) return true;
  toggleAuth();
  return false;
}


// ==========================================
// NAVIGATION & ROUTING
// ==========================================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const targetPage = document.getElementById('page-' + name);
  if(targetPage) targetPage.classList.add('active');

  document.querySelectorAll('nav button').forEach(button => {
    button.classList.toggle('on', button.id === 'nav-' + name);
  });

  if (name === 'feed') renderFeed();
  if (name === 'videos') renderVideos();
  if (name === 'lost') renderLost();
  if (name === 'news') renderNews();
  if (name === 'profile') renderProfile();
  if (name === 'dm') renderDM();
  if (name === 'notifs') renderNotifs();
  
  renderHeader();
}

function renderHeader() {
  const box = document.getElementById('header-buttons');
  if (!box) return;
  
  if (!me) { 
    box.innerHTML = '<button class="btn" onclick="toggleAuth()">Log in / Sign Up</button>'; 
    return; 
  }
  
  const unread = data.notifs.filter(n => n.to === me && !n.read).length;
  box.innerHTML =
    '<button class="small" onclick="showPage(\'dm\')">DM</button>' +
    '<button class="small" onclick="showPage(\'notifs\')">Bell ' + (unread ? '(' + unread + ')' : '') + '</button>' +
    '<button class="small" onclick="logout()">Log out</button>';
}


// ==========================================
// UTILITY & SECURITY HELPERS
// ==========================================
function safe(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function safeAttr(text) {
  return safe(text).replace(/"/g, '&quot;');
}

function initials(name) {
  if (!name) return 'CX';
  return name.split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

async function notify(to, text){
  if(to === me) return;
  const newNotif = { to: to, text: text, read: false };
  await supabaseClient.from('notifs').insert([newNotif]);
  data.notifs.unshift(newNotif);
}

function readImage(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}


// ==========================================
// HOME FEED & POST MANAGEMENT (SUPABASE SYNCED)
// ==========================================
function findPost(id) { 
  const post = data.post.find(p => p.id === id);
  if (post) {
    if (!Array.isArray(post.likes)) post.likes = [];
    if (!Array.isArray(post.refeed)) post.refeed = [];
    if (!Array.isArray(post.comments)) post.comments = [];
  }
  return post;
}

function toggleName(list) {
  const i = list.indexOf(me);
  if (i === -1) { list.push(me); return true; }
  list.splice(i, 1); return false;
}

async function toggleLike(id) {
  if (!requiredlogin()) return;
  const post = findPost(id);
  if (post) {
    const liked = toggleName(post.likes);
    if (liked) notify(post.author, me + ' liked your post');
    await supabaseClient.from('posts').update({ likes: post.likes }).eq('id', id);
    renderFeed();
  }
}

async function toggleRefeed(id) {
  if (!requiredlogin()) return;
  const post = findPost(id);
  if (post) {
    const refeeded = toggleName(post.refeed);
    if (refeeded) notify(post.author, me + ' refeeded your post');
    await supabaseClient.from('posts').update({ refeed: post.refeed }).eq('id', id);
    renderFeed();
  }
}

async function addComment(id) {
  if (!requiredlogin()) return;
  const text = await requestText('Add a comment', 'Write your comment');
  if (!text) return;
  const post = findPost(id);
  if (post) {
    post.comments.push({ by: me, text: text });
    notify(post.author, me + ' commented: ' + text.slice(0, 40));
    await supabaseClient.from('posts').update({ comments: post.comments }).eq('id', id);
    renderFeed();
  }
}

function shareContent(type, id) {
  const url = new URL(window.location.href);
  url.hash = type + '-' + encodeURIComponent(id);
  const text = url.toString();
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast('Link copied to clipboard.'));
  } else {
    requestText('Copy this link', 'Select and copy the link', text, 'Done');
  }
}

async function reportContent(type, id) {
  if (!requiredlogin()) return;
  if (!data.reports.some(r => r.type === type && r.id === id && r.by === me)) {
    const reportData = { type: type, id: id, by: me };
    await supabaseClient.from('reports').insert([reportData]);
    data.reports.push(reportData);
  }
  showToast('Report submitted to moderation.');
  renderFeed();
}

function renderFeed(){
  const feedList = document.getElementById('feed-list');
  if (!feedList) return;

  let html = '';
  if (!data.post || data.post.length === 0) {
    feedList.innerHTML = '<p style="text-align: center; color: var(--details); padding: 20px;">No posts on campus yet. Be the first to post!</p>';
    return;
  }

  for (const post of data.post){
    if (isExpiredContent(post)) continue;
    const likes = Array.isArray(post.likes) ? post.likes : [];
    const refeeders = Array.isArray(post.refeed) ? post.refeed : [];
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const liked = likes.includes(me);
    const refeed = refeeders.includes(me);
    const reported = data.reports.some(r => r.type === 'post' && r.id === post.id && r.by === me);
    let commentsHTML = '';
    
    for (const c of comments){
      commentsHTML += '<div class="comment"><b>' + safe(c.by) + '</b>: ' + safe(c.text) + '</div>';
    }
    
    html += `
      <div class="post" id="post-${post.id}">
        <div class="avatar" title="${safe(post.author)}">${initials(post.author)}</div>
        <div class="body">
          <b>${safe(post.author)}</b> <span class="muted">· ${safe(post.programme)}</span>
          <p>${safe(post.text)}</p>
          ${post.img ? '<img src="' + safeAttr(post.img) + '" alt="Post attachment">' : ''}
          <div class="actions">
            <button class="small btn-action" onclick="toggleLike(${post.id})">${liked ? 'Liked ❤️' : 'Like'} (${likes.length})</button>
            <button class="small btn-action" onclick="addComment(${post.id})">Comment (${comments.length})</button>
            <button class="small btn-action" onclick="toggleRefeed(${post.id})">${refeed ? 'Refeeded 🔄' : 'Refeed'} (${refeeders.length})</button>
            <button class="small btn-action" onclick="shareContent('post', ${post.id})">Share</button>
            <button class="small btn-action" data-chat="${safeAttr(post.author)}">DM</button>
            <button class="small btn-action" onclick="reportContent('post', ${post.id})" ${reported ? 'disabled' : ''}>${reported ? 'Reported' : 'Report'}</button>
          </div>
          <div class="comments-section">${commentsHTML}</div>
        </div>
      </div>
    `;
  }
  feedList.innerHTML = html;
  feedList.querySelectorAll('[data-chat]').forEach(button => {
    button.addEventListener('click', () => startChat(button.dataset.chat));
  });
}

async function addPost(){
  if(!requiredlogin()) return;
  const textInput = document.getElementById('new-post');
  const fileInput = document.getElementById('new-post-img');
  const text = textInput.value.trim();
  
  if (!text && (!fileInput.files || !fileInput.files[0])) {
    showToast('Write something or attach an image before posting.');
    return;
  }

  try {
    const img = await readImage(fileInput);
    const user = myUser();
    const newPost = {
      id: Date.now(), 
      author: me, 
      programme: user.dept || 'Student',
      text: text, 
      img: img, 
      likes: [], 
      refeed: [], 
      comments: []
    };
    
    const { error } = await supabaseClient.from('posts').insert([newPost]);
    if (error) {
      console.error('Post upload failed:', error);
      showToast('Error uploading post to cloud.');
      return;
    }

    data.post.unshift(newPost);
    textInput.value = '';
    fileInput.value = '';
    renderFeed();
    showToast('🚀 Posted to CampusX!');
  } catch (err) {
    console.error('Could not prepare post:', err);
    showToast('Could not post. Check your connection and try again.');
  }
}


// ==========================================
// VIDEOS, LOST & FOUND, NEWS, PROFILE, DMs
// ==========================================
function renderVideos() {
  const container = document.getElementById('video-list');
  if(!container) return;
  let html = '';
  for (const v of videos) {
    if (isExpiredContent(v)) continue;
    const media = v.src ? '<video src="' + v.src + '" controls loop playsinline></video>' : '';
    const comments = (v.comments || []).map(c => '<div class="comment"><b>' + safe(c.by) + '</b>: ' + safe(c.text) + '</div>').join('');
    html += '<div class="reel">' + media + '<div class="info"><b>' + safe(v.by) + '</b><br>' + safe(v.desc) + comments + '</div></div>';
  }
  container.innerHTML = html;
}

function addVideo() {
  if (!requiredlogin()) return;
  const file = document.getElementById('v-file').files[0];
  if (!file) { showToast('Choose a video first.'); return; }
  const u = myUser();
  videos.unshift({
    id: Date.now(), by: me, dept: u.dept, index: u.index, skills: u.skills,
    desc: document.getElementById('v-desc').value,
    src: URL.createObjectURL(file), createdAt: Date.now(), likes: [], comments: []
  });
  renderVideos();
}

function renderLost() {
  const search = (document.getElementById('lost-search')?.value || '').trim().toLowerCase();
  let chips = '';
  for (const c of ['All', 'Phone', 'Bag', 'Book', 'Pen', 'Other']){
    chips += '<button class="chip ' + (c === category ? 'on' : '') + '" onclick="setLostCategory(\'' + c + '\')">' + c + '</button>';
  }
  const chipsEl = document.getElementById('lost-chips');
  if(chipsEl) chipsEl.innerHTML = chips;

  let html = '';
  for (const item of data.lost) {
    if (category !== 'All' && item.category !== category) continue;
    const searchableText = `${item.title || ''} ${item.comment || ''} ${item.category || ''}`.toLowerCase();
    if (search && !searchableText.includes(search)) continue;
    html += '<div class="card"><b>' + safe(item.title) + '</b><p>' + safe(item.comment) + '</p></div>';
  }
  const lostList = document.getElementById('lost-list');
  if(lostList) lostList.innerHTML = html || '<p class="muted">No lost items reported.</p>';
}

function setLostCategory(val) { category = val; renderLost(); }

async function addLost() {
  if (!requiredlogin()) return;
  const title = document.getElementById('l-title').value.trim();
  if (!title) { showToast('Enter item name.'); return; }
  try {
    const imageInput = document.getElementById('l-img');
    const img = await readImage(imageInput);
    const u = myUser();
    const newItem = {
      id: Date.now(), title: title, category: document.getElementById('l-category').value,
      by: me, phone: u.phone, dept: u.dept, comment: document.getElementById('l-comment').value, img: img, recovered: false
    };
    const { error } = await supabaseClient.from('lost').insert([newItem]);
    if (error) {
      console.error('Lost item upload failed:', error);
      showToast('Error reporting the lost item. Please try again.');
      return;
    }
    data.lost.unshift(newItem);
    document.getElementById('l-title').value = '';
    document.getElementById('l-comment').value = '';
    imageInput.value = '';
    renderLost();
    showToast('Lost item reported.');
  } catch (err) {
    console.error('Could not prepare lost item:', err);
    showToast('Could not report the item. Check your connection and try again.');
  }
}

function renderNews() {
  const newsList = document.getElementById('news-list');
  if(!newsList) return;
  newsList.innerHTML = announcements.map(a => '<div class="card news"><b>' + a.from + '</b><p>' + a.text + '</p></div>').join('');
}

function renderProfile() {
  const box = document.getElementById('profile-box');
  if(!box) return;
  if (!me) { box.innerHTML = '<p>Please log in.</p><button class="btn" onclick="toggleAuth()">Log in</button>'; return; }
  const u = myUser();
  box.innerHTML = `
    <div class="post"><div class="avatar">${initials(me)}</div><div><b>${safe(me)}</b><br><span class="muted">${safe(u.dept)} · ${safe(u.index)}</span></div></div>
    <input id="p-phone" placeholder="Phone" value="${safeAttr(u.phone)}">
    <input id="p-dept" placeholder="Department" value="${safeAttr(u.dept)}">
    <input id="p-index" placeholder="Index number" value="${safeAttr(u.index)}">
    <input id="p-skills" placeholder="Skills" value="${safeAttr(u.skills)}">
    <button class="btn" onclick="saveProfile()">Save profile</button>`;
}

async function saveProfile() {
  if (!requiredlogin()) return;
  const u = myUser();
  u.phone = document.getElementById('p-phone').value;
  u.dept = document.getElementById('p-dept').value;
  u.index = document.getElementById('p-index').value;
  u.skills = document.getElementById('p-skills').value;
  
  await supabaseClient.from('users').update({
    phone: u.phone, dept: u.dept, index: u.index, skills: u.skills
  }).eq('name', me);

  showToast('Profile updated in cloud.');
  renderProfile();
}

function startChat(name) {
  if (!requiredlogin()) return;
  if (!name || name === me) return;
  chatWith = name;
  showPage('dm');
}

function renderDM() {
  const box = document.getElementById('dm-box');
  if(!box) return;
  if (!me) { box.innerHTML = '<p>Please log in.</p>'; return; }
  if (chatWith) {
    box.innerHTML = '<button class="small" onclick="chatWith=null;renderDM()">Back</button> <b>' + safe(chatWith) + '</b><input id="dm-text" placeholder="Message..."><button class="btn" onclick="sendMessage()">Send</button>';
    return;
  }
  box.innerHTML = '<input id="dm-new" placeholder="Type a name to chat"><button class="btn" onclick="startChat(document.getElementById(\'dm-new\').value.trim())">Chat</button>';
}

function sendMessage() {
  showToast('Message sent!');
}

function renderNotifs() {
  const notifList = document.getElementById('notif-list');
  if(!notifList) return;
  notifList.innerHTML = data.notifs.filter(n => n.to === me).map(n => '<div class="card">' + safe(n.text) + '</div>').join('') || '<p class="muted">No notifications.</p>';
}