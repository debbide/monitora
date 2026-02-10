import os

def resolve_conflict(file_path):
    print(f"Checking {file_path}")
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    new_lines = []
    i = 0
    modified = False
    while i < len(lines):
        if lines[i].startswith('<<<<<<<'):
            modified = True
            # Find the ====== and >>>>>>>
            j = i + 1
            separator_idx = -1
            end_idx = -1
            while j < len(lines):
                if lines[j].startswith('======='):
                    separator_idx = j
                elif lines[j].startswith('>>>>>>>'):
                    end_idx = j
                    break
                j += 1
            
            if separator_idx != -1 and end_idx != -1:
                # Keep the bottom part (from separator to end)
                # Logic: Typically the secondary branch has the newer features
                new_lines.extend(lines[separator_idx + 1:end_idx])
                i = end_idx + 1
            else:
                # Not a standard marker pair, skip marker
                i += 1
        else:
            new_lines.append(lines[i])
            i += 1
    
    if modified:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
        print(f"Fixed {file_path}")

def main():
    for root, dirs, files in os.walk('.'):
        if '.git' in dirs:
            dirs.remove('.git')
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if 'dist' in dirs:
            dirs.remove('dist')
            
        for file in files:
            if file.endswith(('.ts', '.tsx', '.js', '.jsx')):
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        if '<<<<<<<' in f.read():
                            resolve_conflict(file_path)
                except Exception as e:
                    print(f"Error processing {file_path}: {e}")

if __name__ == "__main__":
    main()
