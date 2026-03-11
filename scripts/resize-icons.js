const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [16, 32, 48, 128];
const inputImage = process.argv[2];
const outputDir = path.join(__dirname, 'public', 'icons');

if (!inputImage) {
  console.error('Please provide an input image path.');
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function resizeIcons() {
  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon${size}.png`);
    await sharp(inputImage)
      .resize(size, size)
      .toFile(outputPath);
    console.log(`Generated ${outputPath}`);
  }
}

resizeIcons().catch(console.error);
