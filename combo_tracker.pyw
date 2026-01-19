import tkinter as tk
from tkinter import ttk, messagebox
from pynput import keyboard, mouse
import time
import threading

class ComboTrackerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Combo Trainer (Mouse & Keyboard)")
        self.root.geometry("550x650")

        # --- Data & State ---
        self.combos = {}
        self.active_combo_name = None
        self.active_combo_keys = []
        self.current_index = 0
        self.start_time = 0
        self.last_input_time = 0
        self.is_listening = True

        # --- UI Layout ---
        
        # 1. Add New Combo
        frame_add = tk.LabelFrame(root, text="Add New Combo", padx=10, pady=10)
        frame_add.pack(fill="x", padx=10, pady=5)

        tk.Label(frame_add, text="Name:").grid(row=0, column=0, sticky="w")
        self.entry_name = tk.Entry(frame_add, width=15)
        self.entry_name.grid(row=0, column=1, padx=5)

        tk.Label(frame_add, text="Inputs (comma sep):").grid(row=0, column=2, sticky="w")
        self.entry_keys = tk.Entry(frame_add, width=25)
        self.entry_keys.grid(row=0, column=3, padx=5)
        
        # Helper text for mouse inputs
        lbl_help = tk.Label(frame_add, text="Use: LMB, RMB, MMB for mouse clicks.\nEx: a, w, LMB, d, RMB", fg="gray", font=("Arial", 8))
        lbl_help.grid(row=1, column=3, sticky="w", padx=5)

        btn_add = tk.Button(frame_add, text="Save", command=self.add_combo)
        btn_add.grid(row=0, column=4, padx=5)

        # 2. Select Combo
        frame_select = tk.LabelFrame(root, text="Practice", padx=10, pady=10)
        frame_select.pack(fill="x", padx=10, pady=5)

        tk.Label(frame_select, text="Select Combo:").pack(side="left")
        self.combo_selector = ttk.Combobox(frame_select, state="readonly")
        self.combo_selector.pack(side="left", padx=10, fill="x", expand=True)
        self.combo_selector.bind("<<ComboboxSelected>>", self.set_active_combo)

        # 3. Status
        self.lbl_status = tk.Label(root, text="Status: Select a combo to start", font=("Arial", 12, "bold"), fg="gray")
        self.lbl_status.pack(pady=10)

        # 4. Results Table
        self.tree = ttk.Treeview(root, columns=("Input", "Split (ms)", "Total (ms)"), show="headings")
        self.tree.heading("Input", text="Input Pressed")
        self.tree.heading("Split (ms)", text="Gap (ms)")
        self.tree.heading("Total (ms)", text="Time from Start (ms)")
        self.tree.pack(fill="both", expand=True, padx=10, pady=10)

        # --- Listeners ---
        # We start both listeners. They run in separate threads automatically.
        self.key_listener = keyboard.Listener(on_press=self.on_key_press)
        self.mouse_listener = mouse.Listener(on_click=self.on_mouse_click)
        
        self.key_listener.start()
        self.mouse_listener.start()

    # --- Input Normalization ---

    def normalize_key(self, key):
        """Convert keyboard events to readable strings"""
        try:
            return key.char.lower()
        except AttributeError:
            return key.name.lower() # e.g., space, enter, shift

    def normalize_mouse(self, button):
        """Convert mouse objects to LMB, RMB, MMB strings"""
        if button == mouse.Button.left:
            return "lmb"
        elif button == mouse.Button.right:
            return "rmb"
        elif button == mouse.Button.middle:
            return "mmb"
        else:
            return "mouse_extra"

    # --- Core Logic ---

    def process_input(self, input_name):
        """Unified handler for both Mouse and Keyboard"""
        if not self.active_combo_keys:
            return

        target_input = self.active_combo_keys[self.current_index]

        # 1. Start of Combo
        if self.current_index == 0:
            if input_name == target_input:
                self.start_time = time.perf_counter()
                self.last_input_time = self.start_time
                self.record_hit(input_name, 0, 0)
                self.current_index += 1
                self.update_status("Recording...", "green")
            else:
                pass # Ignore random inputs before start

        # 2. During Combo
        else:
            current_time = time.perf_counter()
            
            if input_name == target_input:
                # HIT
                split_ms = (current_time - self.last_input_time) * 1000
                total_ms = (current_time - self.start_time) * 1000
                
                self.record_hit(input_name, split_ms, total_ms)
                
                self.last_input_time = current_time
                self.current_index += 1

                if self.current_index >= len(self.active_combo_keys):
                    self.update_status(f"Combo '{self.active_combo_name}' Complete!", "green")
                    self.current_index = 0
            else:
                # MISS
                self.tree.insert("", "end", values=(f"{input_name} (Exp: {target_input})", "FAIL", "FAIL"))
                self.update_status("Combo Dropped (Wrong Input)", "red")
                self.tree.yview_moveto(1)
                self.current_index = 0

    # --- Event Callbacks ---

    def on_key_press(self, key):
        key_name = self.normalize_key(key)
        # Schedule the logic on the main thread (Tkinter isn't thread-safe)
        self.root.after(0, lambda: self.process_input(key_name))

    def on_mouse_click(self, x, y, button, pressed):
        if pressed:
            btn_name = self.normalize_mouse(button)
            self.root.after(0, lambda: self.process_input(btn_name))

    # --- GUI Helpers ---

    def add_combo(self):
        name = self.entry_name.get().strip()
        keys_str = self.entry_keys.get().strip()
        
        if not name or not keys_str:
            messagebox.showerror("Error", "Please fill in Name and Inputs.")
            return

        # Parse inputs (remove spaces, lower case)
        input_list = [k.strip().lower() for k in keys_str.split(',')]
        
        self.combos[name] = input_list
        self.combo_selector['values'] = list(self.combos.keys())
        self.combo_selector.current(len(self.combos)-1)
        self.set_active_combo(None)
        
        self.entry_name.delete(0, tk.END)
        self.entry_keys.delete(0, tk.END)

    def set_active_combo(self, event):
        name = self.combo_selector.get()
        if name in self.combos:
            self.active_combo_name = name
            self.active_combo_keys = self.combos[name]
            self.reset_tracking()
            start_key = self.active_combo_keys[0].upper()
            self.lbl_status.config(text=f"Ready! Press '{start_key}' to start.", fg="blue")

    def reset_tracking(self):
        self.current_index = 0
        self.start_time = 0
        self.last_input_time = 0
        for item in self.tree.get_children():
            self.tree.delete(item)

    def record_hit(self, name, split, total):
        self.tree.insert("", "end", values=(name, f"{split:.1f}", f"{total:.1f}"))
        self.tree.yview_moveto(1)

    def update_status(self, text, color):
        self.lbl_status.config(text=text, fg=color)

if __name__ == "__main__":
    root = tk.Tk()
    app = ComboTrackerApp(root)
    root.mainloop()
