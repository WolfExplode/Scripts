import tkinter as tk
from tkinter import ttk, messagebox
from pynput import keyboard
import time
import threading

class ComboTrackerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Game Combo Timing Tracker")
        self.root.geometry("500x600")

        # --- Data & State ---
        self.combos = {}  # Dictionary to store combo names and key sequences
        self.active_combo_name = None
        self.active_combo_keys = []
        self.current_index = 0
        self.start_time = 0
        self.last_key_time = 0
        self.recorded_logs = []
        self.is_listening = True

        # --- UI Layout ---
        
        # 1. Add New Combo Section
        frame_add = tk.LabelFrame(root, text="Add New Combo", padx=10, pady=10)
        frame_add.pack(fill="x", padx=10, pady=5)

        tk.Label(frame_add, text="Name:").grid(row=0, column=0, sticky="w")
        self.entry_name = tk.Entry(frame_add, width=15)
        self.entry_name.grid(row=0, column=1, padx=5)

        tk.Label(frame_add, text="Keys (comma separated):").grid(row=0, column=2, sticky="w")
        self.entry_keys = tk.Entry(frame_add, width=20)
        self.entry_keys.grid(row=0, column=3, padx=5)
        # Placeholder/Tooltip
        tk.Label(frame_add, text="Ex: a, s, space, enter").grid(row=1, column=3, sticky="w",  padx=5)

        btn_add = tk.Button(frame_add, text="Save Combo", command=self.add_combo)
        btn_add.grid(row=0, column=4, padx=5)

        # 2. Select Combo Section
        frame_select = tk.LabelFrame(root, text="Practice", padx=10, pady=10)
        frame_select.pack(fill="x", padx=10, pady=5)

        tk.Label(frame_select, text="Select Combo:").pack(side="left")
        self.combo_selector = ttk.Combobox(frame_select, state="readonly")
        self.combo_selector.pack(side="left", padx=10, fill="x", expand=True)
        self.combo_selector.bind("<<ComboboxSelected>>", self.set_active_combo)

        # 3. Status & Feedback
        self.lbl_status = tk.Label(root, text="Status: Select a combo to start", font=("Arial", 12, "bold"), fg="gray")
        self.lbl_status.pack(pady=10)

        # 4. Results Display
        self.tree = ttk.Treeview(root, columns=("Key", "Split (ms)", "Total (ms)"), show="headings")
        self.tree.heading("Key", text="Key Pressed")
        self.tree.heading("Split (ms)", text="Gap (ms)")
        self.tree.heading("Total (ms)", text="Time from Start (ms)")
        self.tree.pack(fill="both", expand=True, padx=10, pady=10)

        # --- Keyboard Listener ---
        # We start the listener in a non-blocking way
        self.listener = keyboard.Listener(on_press=self.on_key_press)
        self.listener.start()

    def normalize_key(self, key):
        """Converts pynput key objects to simple strings."""
        try:
            # Alphanumeric keys
            return key.char.lower()
        except AttributeError:
            # Special keys (space, enter, shift, etc.)
            return key.name

    def add_combo(self):
        name = self.entry_name.get().strip()
        keys_str = self.entry_keys.get().strip()
        
        if not name or not keys_str:
            messagebox.showerror("Error", "Please fill in both Name and Keys.")
            return

        # Parse keys (remove spaces, lower case)
        key_list = [k.strip().lower() for k in keys_str.split(',')]
        
        self.combos[name] = key_list
        self.combo_selector['values'] = list(self.combos.keys())
        self.combo_selector.current(len(self.combos)-1)
        self.set_active_combo(None)
        
        # Clear inputs
        self.entry_name.delete(0, tk.END)
        self.entry_keys.delete(0, tk.END)

    def set_active_combo(self, event):
        name = self.combo_selector.get()
        if name in self.combos:
            self.active_combo_name = name
            self.active_combo_keys = self.combos[name]
            self.reset_tracking()
            self.lbl_status.config(text=f"Ready! Press '{self.active_combo_keys[0].upper()}' to start.", fg="blue")

    def reset_tracking(self):
        self.current_index = 0
        self.start_time = 0
        self.last_key_time = 0
        self.recorded_logs = []
        # Clear table
        for item in self.tree.get_children():
            self.tree.delete(item)

    def on_key_press(self, key):
        # If no combo selected, ignore
        if not self.active_combo_keys:
            return

        pressed_key = self.normalize_key(key)
        target_key = self.active_combo_keys[self.current_index]

        # 1. Check if we are waiting for the FIRST key
        if self.current_index == 0:
            if pressed_key == target_key:
                # START RECORDING
                self.start_time = time.perf_counter()
                self.last_key_time = self.start_time
                self.record_hit(pressed_key, 0, 0)
                self.current_index += 1
                self.update_status("Recording...", "green")
            else:
                # Ignore random keys while waiting to start
                pass

        # 2. Check subsequent keys
        else:
            current_time = time.perf_counter()
            
            if pressed_key == target_key:
                # CORRECT KEY
                split_ms = (current_time - self.last_key_time) * 1000
                total_ms = (current_time - self.start_time) * 1000
                
                self.record_hit(pressed_key, split_ms, total_ms)
                
                self.last_key_time = current_time
                self.current_index += 1

                # Check if combo finished
                if self.current_index >= len(self.active_combo_keys):
                    self.update_status(f"Combo '{self.active_combo_name}' Complete!", "green")
                    self.current_index = 0 # Reset to allow immediate retry
            
            else:
                # WRONG KEY - FAIL
                # We log the mistake so user sees what happened
                self.tree.insert("", "end", values=(f"{pressed_key} (Expected: {target_key})", "FAIL", "FAIL"))
                self.update_status("Combo Dropped (Wrong Key)", "red")
                self.current_index = 0 # Reset to allow immediate retry

    def record_hit(self, key_name, split, total):
        # Insert into treeview (Must be done on main thread ideally, but typically safe here for simple apps)
        # For strict thread safety in larger apps, use root.after(), but this works for this scope.
        self.tree.insert("", "end", values=(key_name, f"{split:.1f}", f"{total:.1f}"))
        # Auto scroll to bottom
        self.tree.yview_moveto(1)

    def update_status(self, text, color):
        self.lbl_status.config(text=text, fg=color)

if __name__ == "__main__":
    root = tk.Tk()
    app = ComboTrackerApp(root)
    root.mainloop()