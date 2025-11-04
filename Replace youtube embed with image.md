// Check minimum required Excalidraw Automate version
if(!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("2.14.2")) {
  new ea.obsidian.Notice("This script requires Excalidraw plugin version 2.14.2 or higher. Please update your plugin.");
  return;
}

// -----------------------------------------------------
// 1. Initialization and Data Structures
// -----------------------------------------------------
const selectedElements = ea.getViewSelectedElements();
// Regex to capture YouTube IDs from standard and short URLs
// Group 1: Video ID
// Group 2: Full query/hash string (to preserve timestamps like ?t=993)
const youtubeRegex = /^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|live\/))([a-zA-Z0-9_-]{11})([^&\s]*)/;

// -----------------------------------------------------
// 2. Scan Selection for YouTube Links
// -----------------------------------------------------
if (selectedElements.length === 0) {
  new ea.obsidian.Notice("Please select at least one element containing a YouTube link.");
  return;
}

const boundingBox = ea.getBoundingBox(selectedElements);

// Map to store data needed for new image creation
const linksToProcess = new Map();
const originalElementIds = new Set();

for (const el of selectedElements) {
  // Check both text content (for text elements) and the element's link property
  let url = el.type === "text" ? el.text.trim() : el.link;

  if (!url) continue;

  const match = url.match(youtubeRegex);

  if (match) {
    const videoID = match[1];
    // Reconstruct the full link to preserve the timestamp, e.g., ?t=993
    const fullLink = `https://youtu.be/${videoID}${match[2] || ""}`; 
    // Construct the direct link to the high-resolution thumbnail image
    const thumbnailUrl = `https://img.youtube.com/vi/${videoID}/maxresdefault.jpg`;
    
    // Store the data needed for image creation
    if (!linksToProcess.has(fullLink)) {
        linksToProcess.set(fullLink, {
            thumbnailUrl,
            fullLink,
            // Use the bounding box center for placing the new image
            x: boundingBox.topX + boundingBox.width / 2, 
            y: boundingBox.topY + boundingBox.height / 2
        });
    }

    // Mark the current element for deletion
    originalElementIds.add(el.id);
  }
}

if (linksToProcess.size === 0) {
  new ea.obsidian.Notice("No valid YouTube links found in the selected elements.");
  return;
}

// -----------------------------------------------------
// 3. Delete Old Elements and Prepare Workbench
// -----------------------------------------------------

// Copy all currently selected elements to the workbench for deletion
ea.copyViewElementsToEAforEditing(selectedElements);

// Mark elements that contained a link for deletion
for (const id of originalElementIds) {
    const el = ea.getElement(id);
    if (el) el.isDeleted = true;
}

// -----------------------------------------------------
// 4. Insert New Image Elements AND SET THE LINK EXPLICITLY
// -----------------------------------------------------
const newImageIds = [];
const DEFAULT_WIDTH = 500; // A reasonable default width for a thumbnail
const ASPECT_RATIO = 16/9;

for (const [, linkData] of linksToProcess) {
  
  // 1. Clear or set a temporary link for ea.addImage to ensure proper processing
  ea.style.link = null; 
  
  // 2. Add the image element using the thumbnail URL
  const imageId = await ea.addImage(
    linkData.x - DEFAULT_WIDTH / 2, // Center the image X
    linkData.y - (DEFAULT_WIDTH / ASPECT_RATIO) / 2, // Center the image Y
    linkData.thumbnailUrl, 
    false, // Do not auto-scale to fit max size
    false  // Do not anchor 
  );

  const newImage = ea.getElement(imageId);
  
  if (newImage) {
    // 3. Manually set size and, CRUCIALLY, the correct link directly on the element
    newImage.width = DEFAULT_WIDTH;
    newImage.height = DEFAULT_WIDTH / ASPECT_RATIO;
    newImage.link = linkData.fullLink; // <--- The Fix: Explicitly set the link property
  }
  
  newImageIds.push(imageId);
}

// -----------------------------------------------------
// 5. Commit Changes and Select New Elements
// -----------------------------------------------------

// Commit all deletions and additions to the view
await ea.addElementsToView(false, true, true);

// Select the newly created images for user convenience
ea.selectElementsInView(newImageIds);