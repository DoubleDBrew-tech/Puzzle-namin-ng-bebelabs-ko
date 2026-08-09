import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Your custom Firebase configuration
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
const storage = getStorage(app);

const gridSize = 4; // 4x4 puzzle
const pieceSize = 150; // 150px per piece
const boardSize = 600; 

// Document reference where the puzzle state will live
const docRef = doc(db, "games", "puzzleState");

let localState = null;
let isDragging = false; 

// UI Elements
const uploadBtn = document.getElementById('uploadBtn');
const imageUpload = document.getElementById('imageUpload');
const resetBtn = document.getElementById('resetBtn');
const board = document.getElementById('board');
const tray = document.getElementById('tray');
const gameStatus = document.getElementById('gameStatus');

// Initialize the empty board slots
function setupBoard() {
  board.innerHTML = '';
  for (let i = 0; i < gridSize * gridSize; i++) {
    const slot = document.createElement('div');
    slot.classList.add('slot');
    slot.dataset.index = i;
    
    // Allow dropping pieces here
    slot.addEventListener('dragover', (e) => e.preventDefault());
    slot.addEventListener('drop', (e) => handleDrop(e, `slot-${i}`));
    board.appendChild(slot);
  }
  
  // Allow returning pieces to the tray
  tray.addEventListener('dragover', (e) => e.preventDefault());
  tray.addEventListener('drop', (e) => handleDrop(e, 'tray'));
}

setupBoard();

// Create or move pieces based on the database state
function renderPieces(state) {
  if (!state || !state.imageUrl) return;
  if (isDragging) return; // Prevent board re-drawing while you are actively holding a piece

  // Generate pieces physically if they don't exist yet
  if (document.querySelectorAll('.piece').length === 0) {
    for (let i = 0; i < gridSize * gridSize; i++) {
      const piece = document.createElement('div');
      piece.classList.add('piece');
      piece.id = `piece-${i}`;
      piece.dataset.index = i;
      piece.draggable = true;
      
      // Cut the image by shifting its background position
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

  // Position pieces according to what's in the database
  let correctCount = 0;
  for (let i = 0; i < gridSize * gridSize; i++) {
    const piece = document.getElementById(`piece-${i}`);
    if (!piece) continue;

    const location = state.pieces[i] || 'tray';
    if (location === 'tray') {
      tray.appendChild(piece);
    } else if (location.startsWith('slot-')) {
      const slotIndex = location.split('-')[1];
      const slot = document.querySelector(`.slot[data-index="${slotIndex}"]`);
      if (slot) {
        slot.appendChild(piece);
        // Check if the piece's true index matches the slot's index
        if (slotIndex == i) correctCount++;
      }
    }
  }

  checkWinCondition(correctCount, gridSize * gridSize);
}

// Logic: Won't finish unless ALL pieces are in the right spot
function checkWinCondition(correctCount, total) {
  if (correctCount === total && total > 0) {
    gameStatus.innerText = "🎉 Puzzle Complete! You did it! 🎉";
    gameStatus.style.color = "#4caf50";
  } else {
    gameStatus.innerText = "Keep going! Pieces are missing or in the wrong spot.";
    gameStatus.style.color = "#d81b60";
  }
}

// Sync drops to Firestore
async function handleDrop(e, targetLocation) {
  e.preventDefault();
  const pieceIndex = e.dataTransfer.getData('text/plain');
  
  if (pieceIndex === "") return;
  if (!localState || !localState.pieces) return;
  
  // Rule: Only 1 piece per slot. Kick an existing piece back to the tray.
  if (targetLocation.startsWith('slot-')) {
    const existingPieceIndex = Object.keys(localState.pieces).find(key => localState.pieces[key] === targetLocation);
    if (existingPieceIndex !== undefined && existingPieceIndex !== pieceIndex) {
      localState.pieces[existingPieceIndex] = 'tray'; 
    }
  }

  localState.pieces[pieceIndex] = targetLocation;
  
  try {
    await setDoc(docRef, { pieces: localState.pieces }, { merge: true });
  } catch (error) {
    console.error("Database error:", error);
    alert("Error moving piece. Check your Firebase Security Rules!");
  }
}

// Upload a new image
uploadBtn.addEventListener('click', async () => {
  const file = imageUpload.files[0];
  if (!file) {
    alert("Please select a picture first!");
    return;
  }
  
  gameStatus.innerText = "Uploading picture... please wait!";
  gameStatus.style.color = "#d81b60";
  
  // Upload to Firebase Storage
  const fileRef = ref(storage, 'puzzles/' + file.name + Date.now());
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  
  // Reset all pieces to the tray for the new image
  const initialPieces = {};
  for (let i = 0; i < gridSize * gridSize; i++) {
    initialPieces[i] = 'tray';
  }
  
  // Overwrite the database with the new puzzle
  await setDoc(docRef, {
    imageUrl: url,
    pieces: initialPieces
  });
  
  // Delete the old DOM pieces so they re-render
  document.querySelectorAll('.piece').forEach(p => p.remove()); 
});

// Reset the current puzzle without changing the image
resetBtn.addEventListener('click', async () => {
  if (localState) {
    const initialPieces = {};
    for (let i = 0; i < gridSize * gridSize; i++) {
      initialPieces[i] = 'tray';
    }
    await setDoc(docRef, { pieces: initialPieces }, { merge: true });
  }
});

// Real-time multiplayer listener
onSnapshot(docRef, (docSnap) => {
  if (docSnap.exists()) {
    localState = docSnap.data();
    if (localState.imageUrl) {
      renderPieces(localState);
    }
  } else {
    gameStatus.innerText = "Upload an image to start a new puzzle!";
  }
});
