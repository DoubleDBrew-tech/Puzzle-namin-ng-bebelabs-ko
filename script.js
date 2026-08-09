import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, increment, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAB3HwQfyL32dYL473BG5_bUlGXk30p_-A",
  authDomain: "for-my-bebelabs.firebaseapp.com",
  projectId: "for-my-bebelabs",
  storageBucket: "for-my-bebelabs.firebasestorage.app",
  messagingSenderId: "526591033040",
  appId: "1:526591033040:web:50ac0a437a1fd9017168d5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const boardSize = 600; 
const docRef = doc(db, "games", "puzzleState");
const historyDocRef = doc(db, "games", "puzzleHistory");

let localState = null;
let currentGridSize = 4;
let playerName = localStorage.getItem('bebelabs_user') || "";

let activePiece = null;
let dragOffset = { x: 0, y: 0 };

// DOM Elements
const welcomeScreen = document.getElementById('welcomeScreen');
const playerNameInput = document.getElementById('playerNameInput');
const enterGameBtn = document.getElementById('enterGameBtn');
const displayName = document.getElementById('displayName');
const leaveBtn = document.getElementById('leaveBtn');

const gameScreen = document.getElementById('gameScreen');
const historyPage = document.getElementById('historyPage');
const backToGameBtn = document.getElementById('backToGameBtn');

const hintModal = document.getElementById('hintModal');
const hintImage = document.getElementById('hintImage');
const hintBtn = document.getElementById('hintBtn');
const closeHint = document.getElementById('closeHint');

const historyStats = document.getElementById('historyStats');
const historyBtn = document.getElementById('historyBtn');

const finishBtn = document.getElementById('finishBtn');
const uploadBtn = document.getElementById('uploadBtn');
const imageUpload = document.getElementById('imageUpload');
const resetBtn = document.getElementById('resetBtn');
const gridSelect = document.getElementById('gridSelect');
const board = document.getElementById('board');
const tray = document.getElementById('tray');
const gameStatus = document.getElementById('gameStatus');

// --- AUTH & USER PERSISTENCE ---
function initAuth() {
  if (playerName) {
    displayName.innerText = playerName;
    welcomeScreen.style.display = 'none';
  } else {
    welcomeScreen.style.display = 'flex';
  }

  enterGameBtn.addEventListener('click', () => {
    const val = playerNameInput.value.trim();
    if (val !== "") {
      playerName = val;
      localStorage.setItem('bebelabs_user', playerName);
      displayName.innerText = playerName;
      welcomeScreen.style.display = 'none';
    }
  });

  leaveBtn.addEventListener('click', () => {
    localStorage.removeItem('bebelabs_user');
    playerName = "";
    welcomeScreen.style.display = 'flex';
  });

  const items = ["💖", "💕", "❤️", "I Love Leigh", "Leigh ❤️", "Carlo ❤️"];
  const heartsContainer = document.getElementById('heartsContainer');
  if (heartsContainer) {
    heartsContainer.innerHTML = '';
    for (let i = 0; i < 20; i++) {
      const item = document.createElement('div');
      item.className = 'falling-item';
      item.innerText = items[Math.floor(Math.random() * items.length)];
      item.style.left = `${Math.random() * 100}vw`;
      item.style.animationDuration = `${3 + Math.random() * 5}s`;
      item.style.animationDelay = `${Math.random() * 3}s`;
      item.style.fontSize = `${14 + Math.random() * 12}px`;
      heartsContainer.appendChild(item);
    }
  }
}
initAuth();

// --- PAGE NAVIGATION ---
historyBtn.addEventListener('click', async () => {
  gameScreen.style.display = 'none';
  historyPage.style.display = 'block';
  historyStats.innerHTML = "<p>Fetching achievements...</p>";
  
  try {
    const snap = await getDoc(historyDocRef);
    if (snap.exists()) {
      const data = snap.data();
      historyStats.innerHTML = `
        <div class="rank-card"><h3>🌱 2x2 Beginner Rank</h3> <p>Completed: <strong>${data['rank_2'] || 0}</strong></p></div>
        <div class="rank-card"><h3>🐣 3x3 Novice Rank</h3> <p>Completed: <strong>${data['rank_3'] || 0}</strong></p></div>
        <div class="rank-card"><h3>⭐ 4x4 Intermediate Rank</h3> <p>Completed: <strong>${data['rank_4'] || 0}</strong></p></div>
        <div class="rank-card"><h3>🔥 6x6 Advanced Rank</h3> <p>Completed: <strong>${data['rank_6'] || 0}</strong></p></div>
        <div class="rank-card"><h3>👑 10x10 Master Rank</h3> <p>Completed: <strong>${data['rank_10'] || 0}</strong></p></div>
      `;
    } else {
      historyStats.innerHTML = "<p>No puzzles completed yet!</p>";
    }
  } catch (err) {
    console.error("Error fetching history:", err);
    historyStats.innerHTML = "<p>Failed to load achievements.</p>";
  }
});

backToGameBtn.addEventListener('click', () => {
  historyPage.style.display = 'none';
  gameScreen.style.display = 'block';
});

hintBtn.addEventListener('click', () => {
  if (localState && localState.imageUrl) {
    hintImage.src = localState.imageUrl;
    hintModal.style.display = 'flex';
  } else {
    gameStatus.innerText = "⚠️ Upload a puzzle picture first!";
  }
});
closeHint.addEventListener('click', () => hintModal.style.display = 'none');

// Image processing helper
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 400, 400);
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function generateShuffledOrder(total) {
  const arr = Array.from({ length: total }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setupBoard(gridSize) {
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;
  
  const totalSlots = gridSize * gridSize;
  for (let i = 0; i < totalSlots; i++) {
    const slot = document.createElement('div');
    slot.classList.add('slot');
    slot.dataset.index = i;
    board.appendChild(slot);
  }
}
setupBoard(currentGridSize);

// Helper function to extract coordinates from both mouse/pointer and touch events
function getCoords(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

// --- GLOBAL DRAG MOVE AND RELEASE LISTENERS ---
function handleMove(e) {
  if (!activePiece) return;
  if (e.cancelable) e.preventDefault(); // Stop iPad native scroll while dragging
  
  const coords = getCoords(e);
  activePiece.style.left = `${coords.x - dragOffset.x}px`;
  activePiece.style.top = `${coords.y - dragOffset.y}px`;
}

async function handleEnd(e) {
  if (!activePiece) return;

  const piece = activePiece;
  activePiece = null;

  const coords = getCoords(e);

  piece.classList.remove('dragging');
  const tag = piece.querySelector('.player-tag');
  if (tag) tag.remove();

  // Temporarily hide piece so elementFromPoint identifies underlying grid slot or tray
  piece.style.display = 'none';
  const dropElem = document.elementFromPoint(coords.x, coords.y);
  piece.style.display = 'block';

  piece.style.position = 'relative';
  piece.style.left = '0px';
  piece.style.top = '0px';

  const slot = dropElem ? dropElem.closest('.slot') : null;
  const isOverTray = dropElem ? dropElem.closest('#tray') : null;

  const pieceIdx = piece.dataset.index;
  let targetLocation = 'tray';

  if (slot) {
    targetLocation = `slot-${slot.dataset.index}`;
    const existingPiece = slot.querySelector('.piece');
    if (existingPiece && existingPiece !== piece) {
      tray.appendChild(existingPiece);
    }
    slot.appendChild(piece);
  } else if (isOverTray) {
    targetLocation = 'tray';
    tray.appendChild(piece);
  } else {
    targetLocation = (localState?.pieces?.[`p_${pieceIdx}`]) || 'tray';
    if (targetLocation.startsWith('slot-')) {
      const sIdx = targetLocation.split('-')[1];
      const targetSlot = document.querySelector(`.slot[data-index="${sIdx}"]`);
      if (targetSlot) targetSlot.appendChild(piece);
      else tray.appendChild(piece);
    } else {
      tray.appendChild(piece);
    }
  }

  await updatePieceLocation(pieceIdx, targetLocation);
}

window.addEventListener('pointermove', handleMove, { passive: false });
window.addEventListener('touchmove', handleMove, { passive: false });

window.addEventListener('pointerup', handleEnd);
window.addEventListener('touchend', handleEnd);

// --- DRAG ENGINE & REAL-TIME SYNC ---
function makePieceDraggable(piece) {
  const startDrag = async (e) => {
    const pieceIdx = piece.dataset.index;
    const pKey = `p_${pieceIdx}`;

    if (localState?.activeDrags?.[pKey] && localState.activeDrags[pKey] !== playerName) {
      return;
    }

    if (e.cancelable) e.preventDefault();
    activePiece = piece;

    const coords = getCoords(e);
    const rect = piece.getBoundingClientRect();
    dragOffset.x = coords.x - rect.left;
    dragOffset.y = coords.y - rect.top;

    piece.classList.add('dragging');

    let tag = piece.querySelector('.player-tag');
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'player-tag';
      piece.appendChild(tag);
    }
    tag.innerText = `Holding: ${playerName || "Player"}`;

    piece.style.position = 'fixed';
    piece.style.left = `${coords.x - dragOffset.x}px`;
    piece.style.top = `${coords.y - dragOffset.y}px`;

    document.body.appendChild(piece);

    try {
      await setDoc(docRef, {
        [`activeDrags.${pKey}`]: playerName || "Player"
      }, { merge: true });
    } catch (err) {
      console.error("Drag start sync error:", err);
    }
  };

  piece.addEventListener('pointerdown', startDrag);
  piece.addEventListener('touchstart', startDrag, { passive: false });
}

function renderPieces(state) {
  if (!state) return;
  
  const gridSize = state.gridSize || 4;
  const totalPieces = gridSize * gridSize;

  if (gridSelect.value != gridSize) {
    gridSelect.value = gridSize;
  }

  if (currentGridSize !== gridSize || board.children.length !== totalPieces) {
    currentGridSize = gridSize;
    setupBoard(gridSize);
    document.querySelectorAll('.piece').forEach(p => p.remove());
  }

  if (!state.imageUrl) {
    tray.innerHTML = '';
    gameStatus.innerText = "Select pieces & upload an image!";
    gameStatus.style.color = "#d81b60";
    return;
  }

  const pieceSize = boardSize / gridSize;
  const piecesData = state.pieces || {};
  const activeDrags = state.activeDrags || {};

  for (let i = 0; i < totalPieces; i++) {
    const pKey = `p_${i}`;
    let piece = document.getElementById(`piece-${i}`);
    
    if (!piece) {
      piece = document.createElement('div');
      piece.classList.add('piece');
      piece.id = `piece-${i}`;
      piece.dataset.index = i;
      makePieceDraggable(piece);
      tray.appendChild(piece);
    }
    
    piece.style.width = `${pieceSize}px`;
    piece.style.height = `${pieceSize}px`;
    
    const row = Math.floor(i / gridSize);
    const col = i % gridSize;
    piece.style.backgroundImage = `url("${state.imageUrl}")`;
    piece.style.backgroundSize = `${boardSize}px ${boardSize}px`;
    piece.style.backgroundPosition = `-${col * pieceSize}px -${row * pieceSize}px`;

    if (activePiece && activePiece.dataset.index == i) continue;

    const holdingPlayer = activeDrags[pKey];
    let tag = piece.querySelector('.player-tag');
    if (holdingPlayer && holdingPlayer !== playerName) {
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'player-tag';
        piece.appendChild(tag);
      }
      tag.innerText = `Holding: ${holdingPlayer}`;
      piece.style.opacity = '0.6';
      piece.style.pointerEvents = 'none';
    } else {
      if (tag && !piece.classList.contains('dragging')) {
        tag.remove();
      }
      piece.style.opacity = '1';
      piece.style.pointerEvents = 'auto';
    }

    const loc = piecesData[pKey] || 'tray';

    if (loc.startsWith('slot-')) {
      const slotIndex = loc.split('-')[1];
      const slot = document.querySelector(`.slot[data-index="${slotIndex}"]`);
      if (slot && piece.parentElement !== slot) {
        slot.appendChild(piece);
      }
    } else {
      if (piece.parentElement !== tray) {
        tray.appendChild(piece);
      }
    }
  }

  document.querySelectorAll('.piece').forEach(p => {
    if (parseInt(p.dataset.index) >= totalPieces) {
      p.remove();
    }
  });

  const trayOrder = state.trayOrder || Array.from({ length: totalPieces }, (_, i) => i);
  trayOrder.forEach((pieceIdx) => {
    const piece = document.getElementById(`piece-${pieceIdx}`);
    if (piece && piece.parentElement === tray && (!activePiece || activePiece.dataset.index != pieceIdx)) {
      tray.appendChild(piece);
    }
  });

  if (state.completed) {
    board.classList.add('celebrate-win');
    gameStatus.innerText = state.winnerText || "🎉 Puzzle Complete!";
    gameStatus.style.color = "#4caf50";
  } else {
    board.classList.remove('celebrate-win', 'shake-error');
    gameStatus.innerText = "Drag randomized pieces to solve, then click Finish Puzzle!";
    gameStatus.style.color = "#d81b60";
  }
}

async function updatePieceLocation(pieceIndex, targetLocation) {
  const pKey = `p_${pieceIndex}`;
  const updates = {};

  updates[`pieces.${pKey}`] = targetLocation;
  updates[`activeDrags.${pKey}`] = deleteField();

  if (targetLocation.startsWith('slot-')) {
    if (localState && localState.pieces) {
      Object.keys(localState.pieces).forEach(k => {
        if (localState.pieces[k] === targetLocation && k !== pKey) {
          updates[`pieces.${k}`] = 'tray';
          updates[`placedBy.${k}`] = deleteField();
        }
      });
    }
    updates[`placedBy.${pKey}`] = playerName || "Anonymous";
  } else {
    updates[`placedBy.${pKey}`] = deleteField();
  }

  try {
    await setDoc(docRef, updates, { merge: true });
  } catch (err) {
    console.error("Firestore sync error:", err);
    gameStatus.innerText = "⚠️ Network error saving move.";
  }
}

function triggerCelebration() {
  const overlay = document.getElementById('celebrationOverlay');
  if (!overlay) return;
  overlay.innerHTML = '';
  const emojis = ['🏆', '💖', '⭐', '🎉', '👑', '❤️', '✨'];
  
  for (let i = 0; i < 40; i++) {
    const item = document.createElement('div');
    item.className = 'celebration-item';
    item.innerText = emojis[Math.floor(Math.random() * emojis.length)];
    item.style.left = '50vw';
    item.style.top = '50vh';
    
    const angle = Math.random() * Math.PI * 2;
    const dist = 150 + Math.random() * 350;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    const rot = Math.random() * 720;
    
    item.style.setProperty('--tx', `${tx}px`);
    item.style.setProperty('--ty', `${ty}px`);
    item.style.setProperty('--rot', `${rot}deg`);
    
    overlay.appendChild(item);
  }
  
  setTimeout(() => overlay.innerHTML = '', 2500);
}

// --- GRID & BUTTON LISTENERS ---
gridSelect.addEventListener('change', async () => {
  const newSize = parseInt(gridSelect.value);
  const totalPieces = newSize * newSize;
  const trayOrder = generateShuffledOrder(totalPieces);
  
  const initialPieces = {};
  for (let i = 0; i < totalPieces; i++) {
    initialPieces[`p_${i}`] = 'tray';
  }

  currentGridSize = newSize;
  setupBoard(newSize);
  document.querySelectorAll('.piece').forEach(p => p.remove());

  await setDoc(docRef, {
    gridSize: newSize,
    pieces: initialPieces,
    trayOrder: trayOrder,
    placedBy: {},
    activeDrags: {},
    completed: false,
    winnerText: ""
  }, { merge: true });
});

finishBtn.addEventListener('click', async () => {
  if (!localState || !localState.pieces) return;
  
  const gridSize = localState.gridSize || 4;
  const totalPieces = gridSize * gridSize;
  let correctCount = 0;

  for (let i = 0; i < totalPieces; i++) {
    if (localState.pieces[`p_${i}`] === `slot-${i}`) {
      correctCount++;
    }
  }

  if (correctCount === totalPieces) {
    const tally = {};
    const placedBy = localState.placedBy || {};
    
    for (let i = 0; i < totalPieces; i++) {
      const author = placedBy[`p_${i}`] || "Anonymous";
      tally[author] = (tally[author] || 0) + 1;
    }

    let topPlayer = "";
    let maxPlaced = -1;
    let isTie = false;

    Object.entries(tally).forEach(([player, count]) => {
      if (count > maxPlaced) {
        maxPlaced = count;
        topPlayer = player;
        isTie = false;
      } else if (count === maxPlaced) {
        isTie = true;
      }
    });

    let winnerMsg = isTie 
      ? `🎉 Complete! It's a tie! Both placed equal pieces. ❤️`
      : `🎉 Complete! ${topPlayer} placed the most pieces (${maxPlaced}/${totalPieces})! 👑`;

    triggerCelebration();

    await setDoc(docRef, { 
      completed: true, 
      winnerText: winnerMsg 
    }, { merge: true });
    
    const rankKey = `rank_${gridSize}`;
    try {
      await updateDoc(historyDocRef, { [rankKey]: increment(1) });
    } catch (e) {
      await setDoc(historyDocRef, { [rankKey]: 1 }, { merge: true });
    }

  } else {
    board.classList.remove('shake-error');
    void board.offsetWidth;
    board.classList.add('shake-error');

    gameStatus.innerText = `❌ Incorrect! (${correctCount}/${totalPieces} pieces are in the right spot)`;
    gameStatus.style.color = "#f44336";

    setTimeout(() => board.classList.remove('shake-error'), 600);
  }
});

uploadBtn.addEventListener('click', async () => {
  const file = imageUpload.files[0];
  if (!file) {
    gameStatus.innerText = "⚠️ Please select a picture first!";
    return;
  }
  
  const gridSize = parseInt(gridSelect.value);
  const totalPieces = gridSize * gridSize;

  gameStatus.innerText = "Processing & saving picture...";
  
  try {
    const dataUrl = await processImage(file);
    const trayOrder = generateShuffledOrder(totalPieces);
    
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[`p_${i}`] = 'tray';
    }
    
    document.querySelectorAll('.piece').forEach(p => p.remove());

    await setDoc(docRef, {
      imageUrl: dataUrl,
      gridSize: gridSize,
      pieces: initialPieces,
      trayOrder: trayOrder,
      placedBy: {},
      activeDrags: {},
      completed: false,
      winnerText: ""
    });
    
    gameStatus.innerText = "Puzzle saved & synced for all devices!";
    gameStatus.style.color = "#4caf50";
  } catch (err) {
    console.error("Upload error:", err);
    gameStatus.innerText = "❌ Error saving image. Check database rules/connection.";
    gameStatus.style.color = "#f44336";
  }
});

resetBtn.addEventListener('click', async () => {
  if (localState && localState.gridSize) {
    const totalPieces = localState.gridSize * localState.gridSize;
    const trayOrder = generateShuffledOrder(totalPieces);
    
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[`p_${i}`] = 'tray';
    }
    
    await setDoc(docRef, { 
      pieces: initialPieces, 
      trayOrder: trayOrder,
      placedBy: {},
      activeDrags: {},
      completed: false,
      winnerText: ""
    }, { merge: true });
  }
});

// Firestore listener
onSnapshot(docRef, (docSnap) => {
  if (docSnap.exists()) {
    localState = docSnap.data();
    renderPieces(localState);
  } else {
    setDoc(docRef, {
      gridSize: 4,
      pieces: {},
      trayOrder: [],
      placedBy: {},
      activeDrags: {},
      completed: false,
      winnerText: "",
      imageUrl: ""
    }, { merge: true });
  }
}, (err) => {
  console.error("Realtime sync error:", err);
  gameStatus.innerText = "❌ Sync error: " + err.message;
});
