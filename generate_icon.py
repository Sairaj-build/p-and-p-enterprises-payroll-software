from PIL import Image, ImageDraw

def generate_icons():
    # Load original logo
    img = Image.open('logo.jpg')
    # Crop the central clean logo area
    content = img.crop((70, 25, 450, 230))
    cw, ch = content.size

    # Target icon canvas 512x512
    size = 512

    # Draw rounded squircle card tile (app icon container)
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    margin = 24
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=72,
        fill=(255, 255, 255, 255),
        outline=(226, 232, 240, 255),
        width=4
    )

    # Scale logo content to fit cleanly inside the tile with comfortable padding
    target_w = size - margin * 2 - 48
    scale = target_w / cw
    target_h = int(ch * scale)
    scaled_content = content.resize((int(target_w), target_h), Image.Resampling.LANCZOS)

    # Paste centered
    pos_x = (size - int(target_w)) // 2
    pos_y = (size - target_h) // 2
    tile.paste(scaled_content, (pos_x, pos_y))

    # Save crisp high-res PNG
    tile.save('icon.png', 'PNG')

    # Save Windows multi-resolution ICO (16x16, 24x24, 32x32, 48x48, 64x64, 128x128, 256x256)
    tile.save(
        'icon.ico',
        format='ICO',
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print("Successfully generated icon.ico and icon.png")

if __name__ == '__main__':
    generate_icons()
