import os

def update_Config0h():
    # Define the line to be added
    include_line = '#include "openplc.h"\n'

    # Specify the file path
    file_path = 'src/Config0.h'

    try:
        # Read the content of the file
        with open(file_path, 'r') as file:
            content = file.readlines()

        # Check if the line is already present to avoid duplication
        if content and content[0].strip() == include_line.strip():
            print(f'"{include_line.strip()}" is already present at the top of {file_path}.')
            return

        # Add the line at the beginning
        content.insert(0, include_line)

        # Write the modified content back to the file
        with open(file_path, 'w') as file:
            file.writelines(content)

        print(f'Added "{include_line.strip()}" to {file_path}.')

    except FileNotFoundError:
        print(f'Error: File {file_path} not found.')
    except Exception as e:
        print(f'An error occurred: {e}')

def update_POUSc():
    # Define the line to be added
    include_line = '#include "POUS.h"\n'

    # Specify the file path
    file_path = 'src/POUS.c'

    try:
        # Read the content of the file
        with open(file_path, 'r') as file:
            content = file.readlines()

        # Check if the line is already present to avoid duplication
        if content and content[0].strip() == include_line.strip():
            print(f'"{include_line.strip()}" is already present at the top of {file_path}.')
            return

        # Add the line at the beginning
        content.insert(0, include_line)

        # Write the modified content back to the file
        with open(file_path, 'w') as file:
            file.writelines(content)

        print(f'Added "{include_line.strip()}" to {file_path}.')

    except FileNotFoundError:
        print(f'Error: File {file_path} not found.')
    except Exception as e:
        print(f'An error occurred: {e}')

def update_Res0c():
    try:
        file_path = 'src/Res0.c'
        include_to_comment = 'POUS.c'

        # Read the content of the file
        with open(file_path, 'r') as file:
            lines = file.readlines()

        # Modify the lines
        modified = False
        for i in range(len(lines)):
            line = lines[i].strip()
            if line == f'#include "{include_to_comment}"' and not line.startswith("//"):
                lines[i] = f'//{lines[i]}'
                modified = True

        # Write back the modified lines if changes were made
        if modified:
            with open(file_path, 'w') as file:
                file.writelines(lines)
            print(f'Commented out #include "{include_to_comment}" in {file_path}.')
        else:
            print(f'No changes were made. The line may already be commented or not present.')

    except FileNotFoundError:
        print(f'Error: File {file_path} not found.')
    except Exception as e:
        print(f'An error occurred: {e}')

def update_debugc():
    file_path = 'src/debug.c'
    
    # The code block to be appended
    code_to_append = """
//------------------------------------------------------------------------------
// auto-generated code
//------------------------------------------------------------------------------
extern unsigned long __tick;

uint32_t get_tick()
{
\treturn __tick;
}
"""

    try:
        # Read the existing content to check for duplication
        with open(file_path, 'r') as file:
            content = file.read()

        # Check if a unique part of the code is already there
        if "uint32_t get_tick()" in content:
            print(f'get_tick() code is already present in {file_path}.')
            return

        # Append the code to the end of the file
        with open(file_path, 'a') as file:
            # Ensure we start on a new line if the file doesn't end with one
            if content and not content.endswith('\n'):
                file.write('\n')
            file.write(code_to_append)
        
        print(f'Appended auto-generated code to {file_path}.')

    except FileNotFoundError:
        print(f'Error: File {file_path} not found.')
    except Exception as e:
        print(f'An error occurred: {e}')

def update_glueVars():
    template_path = 'runtime/glueVars.c.j2'
    target_path = 'src/glueVars.c'
    # Dieser String dient als Trenner. Alles davor kommt aus dem Template,
    # alles ab hier (inklusive) kommt aus der generierten Datei.
    split_marker = 'void glueVars()'

    try:
        # 1. Prüfen, ob beide Dateien existieren
        if not os.path.exists(template_path):
            print(f'Error: Template {template_path} not found.')
            return
        if not os.path.exists(target_path):
            print(f'Error: Target {target_path} not found.')
            return

        # 2. Template einlesen (Quelle für den Header)
        with open(template_path, 'r') as f:
            template_content = f.read()

        # 3. Ziel-Datei einlesen (Quelle für den Funktions-Body)
        with open(target_path, 'r') as f:
            target_content = f.read()

        # 4. Schnittpunkte finden
        # Wir suchen "void glueVars()" im Template
        tpl_idx = template_content.find(split_marker)
        if tpl_idx == -1:
            print(f'Error: Marker "{split_marker}" not found in template.')
            return

        # Wir suchen "void glueVars()" im Ziel
        tgt_idx = target_content.find(split_marker)
        if tgt_idx == -1:
            print(f'Error: Marker "{split_marker}" not found in target file.')
            return

        # 5. Zusammenfügen
        # Nimm alles vom Template VOR dem Marker
        new_header = template_content[:tpl_idx]
        
        # Nimm alles vom Ziel AB dem Marker (inklusive void glueVars() und updateTime())
        keep_body = target_content[tgt_idx:]

        final_content = new_header + keep_body

        # 6. Datei überschreiben
        with open(target_path, 'w') as f:
            f.write(final_content)

        print(f'Successfully merged header from {template_path} into {target_path}.')

    except Exception as e:
        print(f'An error occurred in update_glueVars: {e}')

if __name__ == "__main__":
    update_Config0h()
    update_POUSc()
    update_Res0c()
    update_debugc()
    update_glueVars()