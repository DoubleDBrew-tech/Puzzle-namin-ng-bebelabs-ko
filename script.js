import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

let localState = null;
let isDragging = false; 
let currentGridSize = 4;

const uploadBtn = document.getElementById('uploadBtn');
const imageUpload = document.getElementById('imageUpload');
const resetBtn = document.getElementById('resetBtn');
const gridSelect = document.getElementById('gridSelect');
const board = document.getElementById('board');
const tray = document.getElementById('tray');
const gameStatus = document.getElementById('gameStatus');

// Convert and resize uploaded image locally using HTML5 Canvas
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = boardSize;
        canvas.height = boardSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, boardSize, boardSize);
        // Returns compressed image string directly
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Build empty board slots dynamically
function setupBoard(gridSize) {
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;
  
  const totalSlots = gridSize * gridSize;
  for (let i = 0; i < totalSlots; i++) {
    const slot = document.createElement('div');
    slot.classList.add('slot');
    slot.dataset.index = i;
    
    slot.addEventListener('dragover', (e) => e.preventDefault());
    slot.addEventListener('drop', (e) => handleDrop(e, `slot-${i}`));
    board.appendChild(slot);
  }
  
  tray.addEventListener('dragover', (e) => e.preventDefault());
  tray.addEventListener('drop', (e) => handleDrop(e, 'tray'));
}

// Render puzzle pieces
function renderPieces(state) {
  if (!state || !state.imageUrl) return;
  if (isDragging) return; 

  const gridSize = state.gridSize || 4;
  const totalPieces = gridSize * gridSize;
  const pieceSize = boardSize / gridSize;

  if (currentGridSize !== gridSize || board.children.length !== totalPieces) {
    currentGridSize = gridSize;
    setupBoard(gridSize);
    tray.innerHTML = '';
  }

  // Create pieces DOM elements if missing
  if (document.querySelectorAll('.piece').length !== totalPieces) {
    tray.innerHTML = '';
    for (let i = 0; i < totalPieces; i++) {
      const piece = document.createElement('div');
      piece.classList.add('piece');
      piece.id = `piece-${i}`;
      piece.dataset.index = i;
      piece.draggable = true;
      
      piece.style.width = `${pieceSize}px`;
      piece.style.height = `${pieceSize}px`;
      
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;
      piece.style.backgroundImage = `url(${state.imageUrl})`;
      piece.style.backgroundSize = `${boardSize}px ${boardSize}px`;
      piece.style.backgroundPosition = `-${col * pieceSize}px -${row * pieceSize}px`;
      
      piece.addEventListener('dragstart', (e) => {
        isDragging = true;
        e.dataTransfer.setData('text/plain', i);
      });
      piece.addEventListener('dragend', () => {
        isDragging = false;
      });
      
      tray.appendChild(piece);
    }
  }

  // Sync positions from Firestore
  let correctCount = 0;
  for (let i = 0; i < totalPieces; i++) {
    const piece = document.getElementById(`piece-${i}`);
    if (!piece) continue;

    const location = state.pieces ? state.pieces[i] : 'tray';
    if (location === 'tray' || !location) {
      tray.appendChild(piece);
    } else if (location.startsWith('slot-')) {
      const slotIndex = location.split('-')[1];
      const slot = document.querySelector(`.slot[data-index="${slotIndex}"]`);
      if (slot) {
        slot.appendChild(piece);
        if (slotIndex == i) correctCount++;
      }
    }
  }

  checkWinCondition(correctCount, totalPieces);
}

function checkWinCondition(correctCount, total) {
  if (correctCount === total && total > 0) {
    gameStatus.innerText = "🎉 Puzzle Complete! Perfect job! 🎉";
    gameStatus.style.color = "#4caf50";
  } else {
    gameStatus.innerText = `Solving puzzle (${correctCount}/${total} correct)`;
    gameStatus.style.color = "#d81b60";
  }
}

async function handleDrop(e, targetLocation) {
  e.preventDefault();
  const pieceIndex = e.dataTransfer.getData('text/plain');
  if (pieceIndex === "" || !localState || !localState.pieces) return;
  
  // Kick piece out if slot is already occupied
  if (targetLocation.startsWith('slot-')) {
    const existingPieceIndex = Object.keys(localState.pieces).find(key => localState.pieces[key] === targetLocation);
    if (existingPieceIndex !== undefined && existingPieceIndex !== pieceIndex) {
      localState.pieces[existingPieceIndex] = 'tray'; 
    }
  }

  localState.pieces[pieceIndex] = targetLocation;
  await setDoc(docRef, { pieces: localState.pieces }, { merge: true });
}

// Upload picture handler
uploadBtn.addEventListener('click', async () => {
  const file = imageUpload.files[0];
  if (!file) {
    alert("Please select a picture first!");
    return;
  }
  
  const gridSize = parseInt(gridSelect.value);
  const totalPieces = gridSize * gridSize;

  gameStatus.innerText = "Processing image...";
  
  try {
    const dataUrl = await processImage(file);
    
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[i] = 'tray';
    }
    
    await setDoc(docRef, {
      imageUrl: dataUrl,
      gridSize: gridSize,
      pieces: initialPieces
    });
    
    document.querySelectorAll('.piece').forEach(p => p.remove());
    gameStatus.innerText = "Puzzle ready! Move the pieces.";
  } catch (err) {
    console.error(err);
    alert("Error loading picture. Please try another image.");
  }
});

// Reset puzzle handler
resetBtn.addEventListener('click', async () => {
  if (localState && localState.gridSize) {
    const totalPieces = localState.gridSize * localState.gridSize;
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[i] = 'tray';
    }
    await setDoc(docRef, { pieces: initialPieces }, { merge: true });
  }
});

// Real-time listener
onSnapshot(docRef, (docSnap) => {
  if (docSnap.exists()) {
    localState = docSnap.data();
    if (localState.imageUrl) {
      renderPieces(localState);
    }
  }
});
