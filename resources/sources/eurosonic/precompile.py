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

if __name__ == "__main__":
    update_Config0h()
    update_POUSc()
    update_Res0c()
    update_debugc()