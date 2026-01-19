import tkinter as tk
from tkinter import ttk, messagebox
from pynput import keyboard, mouse
import time
import threading
import json
import os
import sys
from pathlib import Path

# no need for backwards compatibility with previous versions of the code. we are still in development phase

class ComboTrackerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Combo Trainer (Mouse & Keyboard)")
        self.root.geometry("700x650")

        # --- Data & State ---
        self.combos = {}
        self.active_combo_name = None
        self.active_combo_tokens = []
        self.active_combo_steps = []
        self.current_index = 0
        self.start_time = 0
        self.last_input_time = 0
        self.is_listening = True
        self.hold_in_progress = False
        self.hold_expected_input = None
        self.hold_started_at = 0.0
        self.hold_row_id = None
        self.hold_required_ms = None
        self.wait_in_progress = False
        self.wait_started_at = 0.0
        self.wait_until = 0.0
        self.wait_row_id = None
        self.wait_required_ms = None
        self.currently_pressed = set()
        self.attempt_counter = 0
        # Combo enders: key -> grace_ms (0 means no grace; wrong press drops immediately)
        self.combo_enders = {}

        # --- Persistence ---
        self.data_dir = self._get_data_dir()
        self.save_path = self.data_dir / "combos.json"

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
        lbl_help = tk.Label(
            frame_add,
            text="Use: LMB, RMB, MMB for mouse clicks.\n"
                 "Hold syntax: hold(space,0.2) or space{0.2}\n"
                 "Wait syntax: wait:0.5\n"
                 "Decimals are seconds; append 'ms' for milliseconds.\n"
                 "Ex: a, w, wait:0.2, LMB, hold(space,0.3), d, RMB",
            fg="gray",
            font=("Arial", 8),
        )
        lbl_help.grid(row=1, column=3, sticky="w", padx=5)

        tk.Label(frame_add, text="Combo enders (key:seconds):").grid(row=2, column=2, sticky="w")
        self.entry_enders = tk.Entry(frame_add, width=25)
        self.entry_enders.grid(row=2, column=3, padx=5, sticky="w")
        btn_apply_enders = tk.Button(frame_add, text="Apply", command=self.apply_enders)
        btn_apply_enders.grid(row=2, column=4, padx=5)

        btn_save = tk.Button(frame_add, text="Save / Update", command=self.save_combo)
        btn_save.grid(row=0, column=4, padx=5)

        btn_new = tk.Button(frame_add, text="New", command=self.new_combo)
        btn_new.grid(row=0, column=5, padx=5)

        # 2. Select Combo
        frame_select = tk.LabelFrame(root, text="Practice", padx=10, pady=10)
        frame_select.pack(fill="x", padx=10, pady=5)

        tk.Label(frame_select, text="Select Combo:").pack(side="left")
        self.combo_selector = ttk.Combobox(frame_select, state="readonly")
        self.combo_selector.pack(side="left", padx=10, fill="x", expand=True)
        self.combo_selector.bind("<<ComboboxSelected>>", self.set_active_combo)

        btn_delete = tk.Button(frame_select, text="Delete", command=self.delete_active_combo)
        btn_delete.pack(side="left", padx=5)

        # 3. Status
        self.lbl_status = tk.Label(root, text="Status: Select a combo to start", font=("Arial", 12, "bold"), fg="gray")
        self.lbl_status.pack(pady=10)

        # 4. Results Table
        self.tree = ttk.Treeview(root, columns=("Input", "Split (ms)", "Total (ms)"), show="headings")
        self.tree.heading("Input", text="Input Pressed")
        self.tree.heading("Split (ms)", text="Gap (ms)")
        self.tree.heading("Total (ms)", text="Time from Start (ms)")
        self.tree.pack(fill="both", expand=True, padx=10, pady=10)
        self.tree.tag_configure("sep", foreground="gray50")

        # --- Listeners ---
        # We start both listeners. They run in separate threads automatically.
        self.key_listener = keyboard.Listener(on_press=self.on_key_press, on_release=self.on_key_release)
        self.mouse_listener = mouse.Listener(on_click=self.on_mouse_click)
        
        self.key_listener.start()
        self.mouse_listener.start()

        # Load saved combos (if any) and hook window close to save.
        self.load_combos()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

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

    def split_inputs(self, keys_str: str):
        """
        Split the Inputs field into tokens by commas, but do NOT split commas that are
        inside hold(...) parentheses or inside {...} braces.

        Example:
          "f, e, hold(e, 0.2), r" -> ["f", "e", "hold(e, 0.2)", "r"]
        """
        s = keys_str or ""
        out = []
        buf = []
        paren = 0
        brace = 0

        for ch in s:
            if ch == "(":
                paren += 1
            elif ch == ")":
                paren = max(0, paren - 1)
            elif ch == "{":
                brace += 1
            elif ch == "}":
                brace = max(0, brace - 1)

            if ch == "," and paren == 0 and brace == 0:
                token = "".join(buf).strip()
                if token:
                    out.append(token)
                buf = []
                continue

            buf.append(ch)

        token = "".join(buf).strip()
        if token:
            out.append(token)

        return out

    def parse_step(self, token: str):
        """
        Parse one combo token into a step.

        Supported formats (case-insensitive for 'hold'/'wait'):
        - Normal press/click: "a", "space", "lmb"
        - Hold: "hold(space,500)" or "space{500}" or "space{500ms}"
        - Wait: "wait:0.5" (minimum delay before next input)

        Returns a dict:
          - press: {"input": "a", "hold_ms": None, "wait_ms": None}
          - hold:  {"input": "space", "hold_ms": 500, "wait_ms": None}
          - wait:  {"input": None, "hold_ms": None, "wait_ms": 500}
        """
        t = (token or "").strip()
        if not t:
            return None

        tl = t.lower()

        # wait:<duration>
        if tl.startswith("wait:"):
            dur = tl[len("wait:"):].strip()
            wait_ms = self._parse_duration(dur)
            if wait_ms is not None:
                return {"input": None, "hold_ms": None, "wait_ms": wait_ms}

        if tl.startswith("hold(") and tl.endswith(")"):
            inner = tl[len("hold("):-1]
            parts = [p.strip() for p in inner.split(",", 1)]
            if len(parts) == 2 and parts[0] and parts[1]:
                hold_ms = self._parse_duration(parts[1])
                if hold_ms is not None:
                    return {"input": parts[0], "hold_ms": hold_ms, "wait_ms": None}

        if "{" in tl and tl.endswith("}"):
            base, rest = tl.split("{", 1)
            ms_str = rest[:-1].replace("ms", "").strip()
            base = base.strip()
            if base:
                hold_ms = self._parse_duration(ms_str)
                if hold_ms is not None:
                    return {"input": base, "hold_ms": hold_ms, "wait_ms": None}

        return {"input": tl, "hold_ms": None, "wait_ms": None}

    def _parse_duration(self, raw: str):
        token = raw.lower().strip()
        if not token:
            return None

        # Accept suffixes "ms" for milliseconds and "s" for seconds.
        if token.endswith("ms"):
            token = token[:-2].strip()
            multiplier = 1
        elif token.endswith("s"):
            token = token[:-1].strip()
            multiplier = 1000
        else:
            multiplier = 1000 if "." in token else 1

        try:
            value = float(token)
        except ValueError:
            return None

        millis = value * multiplier
        if millis <= 0:
            return None
        return int(millis)

    def _active_step(self):
        if 0 <= self.current_index < len(self.active_combo_steps):
            return self.active_combo_steps[self.current_index]
        return None

    def _format_hold_requirement(self, hold_ms: int):
        if hold_ms is None:
            return ""
        if hold_ms % 1000 == 0:
            return f"{hold_ms // 1000:d}s"
        return f"{hold_ms / 1000.0:.3g}s"

    def _format_wait_requirement(self, wait_ms: int):
        return self._format_hold_requirement(wait_ms)

    def _insert_attempt_separator(self):
        self.attempt_counter += 1
        name = self.active_combo_name or "Combo"
        label = f"—— {name} | Attempt {self.attempt_counter} ——"
        self.tree.insert("", "end", values=(label, "", ""), tags=("sep",))
        self.tree.yview_moveto(1)

    def _is_combo_ender(self, input_name: str) -> bool:
        return input_name in self.combo_enders

    def _ender_grace_for(self, input_name: str) -> int:
        """Return grace in ms for this ender key. Missing keys => 0 (no grace)."""
        try:
            return int(self.combo_enders.get(input_name, 0))
        except Exception:
            return 0

    def _within_ender_grace(self, input_name: str) -> bool:
        grace_ms = self._ender_grace_for(input_name)
        if not grace_ms or grace_ms <= 0:
            return False
        if not self.last_input_time:
            return False
        now = time.perf_counter()
        return ((now - self.last_input_time) * 1000) <= float(grace_ms)

    def _start_hold(self, input_name: str, required_ms: int, now: float):
        self.hold_in_progress = True
        self.hold_expected_input = input_name
        self.hold_started_at = now
        self.hold_required_ms = required_ms

        # Insert a visible row immediately so it's clear we're holding.
        req_s = self._format_hold_requirement(required_ms)
        self.hold_row_id = self.tree.insert(
            "",
            "end",
            values=(f"{input_name} (hold ≥ {req_s})", "HOLDING", "..."),
        )
        self.tree.yview_moveto(1)

        self.update_status(
            f"Holding '{input_name.upper()}' (≥ {req_s}). Release OR press next input to continue...",
            "green",
        )

    def _reset_hold_state(self):
        self.hold_in_progress = False
        self.hold_expected_input = None
        self.hold_started_at = 0.0
        self.hold_row_id = None
        self.hold_required_ms = None

    def _start_wait(self, required_ms: int):
        # Wait timing starts from the last successful step time.
        self.wait_in_progress = True
        self.wait_started_at = float(self.last_input_time or time.perf_counter())
        self.wait_required_ms = required_ms
        self.wait_until = self.wait_started_at + (required_ms / 1000.0)

        req_s = self._format_wait_requirement(required_ms)
        self.wait_row_id = self.tree.insert(
            "",
            "end",
            values=(f"wait (≥ {req_s})", "WAITING", "..."),
            tags=("sep",),
        )
        self.tree.yview_moveto(1)
        self.update_status(f"Waiting ≥ {req_s}...", "green")

    def _reset_wait_state(self):
        self.wait_in_progress = False
        self.wait_started_at = 0.0
        self.wait_until = 0.0
        self.wait_row_id = None
        self.wait_required_ms = None

    def _complete_wait(self, now: float, *, fail: bool, reason: str | None = None):
        """
        Complete (or fail) the current wait step and advance/reset state.
        When successful, advances current_index by 1.
        """
        required_ms = int(self.wait_required_ms or 0)
        waited_ms = max(0.0, (now - self.wait_started_at) * 1000)
        req_s = self._format_wait_requirement(required_ms) if required_ms else "?"
        label = f"wait (≥ {req_s}, {waited_ms:.0f}ms)"

        total_ms = (now - self.start_time) * 1000 if self.start_time else 0.0

        if fail:
            if reason:
                label += f" [{reason}]"
            if self.wait_row_id:
                self.tree.item(self.wait_row_id, values=(label, "FAIL", "FAIL"))
            else:
                self.tree.insert("", "end", values=(label, "FAIL", "FAIL"))
            self.tree.yview_moveto(1)
            self.update_status("Combo Dropped (Too Early)", "red")
            self.current_index = 0
            self._reset_hold_state()
            self._reset_wait_state()
            return False

        # success
        split_ms = (now - self.last_input_time) * 1000 if self.last_input_time else 0.0
        if self.wait_row_id:
            self.tree.item(self.wait_row_id, values=(label, f"{split_ms:.1f}", f"{total_ms:.1f}"))
        else:
            self.record_hit(label, split_ms, total_ms)
        self.tree.yview_moveto(1)

        self.last_input_time = now
        self.current_index += 1
        self._reset_wait_state()
        return True

    def _maybe_start_wait_step(self):
        step = self._active_step()
        if not step:
            return
        wait_ms = step.get("wait_ms")
        if wait_ms is not None:
            # Only start once per wait step.
            if not self.wait_in_progress:
                self._start_wait(int(wait_ms))

    def _complete_hold(self, now: float, *, auto: bool):
        """
        Complete the current hold-step (either via release or auto-complete when next input happens).
        Assumes we're currently on a hold-step and hold_in_progress is True.
        """
        step = self._active_step()
        if not step or step["hold_ms"] is None:
            return False

        target_input = step["input"]
        target_hold_ms = step["hold_ms"]

        held_ms = (now - self.hold_started_at) * 1000
        ok = held_ms >= float(target_hold_ms)

        req_s = self._format_hold_requirement(target_hold_ms)
        split_ms = (now - self.last_input_time) * 1000 if self.current_index != 0 else 0.0
        total_ms = (now - self.start_time) * 1000

        label = f"{target_input} (hold ≥ {req_s}, {held_ms:.0f}ms)"
        if auto:
            label += " [auto]"

        if ok:
            if self.hold_row_id:
                self.tree.item(self.hold_row_id, values=(label, f"{split_ms:.1f}", f"{total_ms:.1f}"))
                self.tree.yview_moveto(1)
            else:
                self.record_hit(label, split_ms, total_ms)

            self.last_input_time = now
            self.current_index += 1
            # If next step is a wait, start it immediately for clarity.
            self._maybe_start_wait_step()

            if self.current_index >= len(self.active_combo_steps):
                self.update_status(f"Combo '{self.active_combo_name}' Complete!", "green")
                self.current_index = 0
        else:
            if self.hold_row_id:
                self.tree.item(self.hold_row_id, values=(label, "FAIL", "FAIL"))
                self.tree.yview_moveto(1)
            else:
                self.tree.insert("", "end", values=(label, "FAIL", "FAIL"))

            self.update_status("Combo Dropped (Hold Too Short)", "red")
            self.tree.yview_moveto(1)
            self.current_index = 0

        self._reset_hold_state()
        return ok

    def process_press(self, input_name):
        """Handle press/down events for both Mouse and Keyboard"""
        self.currently_pressed.add(input_name)
        if not self.active_combo_steps:
            return

        # If we're currently on a hold-step and the hold requirement is already satisfied,
        # allow the user to press the next input without releasing the held key.
        # This is common in games (hold-through inputs).
        while True:
            step = self._active_step()
            if not step:
                return

            target_input = step["input"]
            target_hold_ms = step["hold_ms"]
            target_wait_ms = step.get("wait_ms")

            # WAIT step handling
            if target_wait_ms is not None:
                self._maybe_start_wait_step()
                now = time.perf_counter()
                if now < self.wait_until:
                    # Too early: only ender presses fail; everything else is ignored.
                    if self._is_combo_ender(input_name):
                        self._complete_wait(now, fail=True, reason=f"{input_name} too early")
                    return
                # Wait satisfied: complete and then re-evaluate this same input against next step.
                self._complete_wait(now, fail=False)
                continue

            if target_hold_ms is not None and self.hold_in_progress and self.hold_expected_input == target_input:
                # Ignore repeated press events for the same held input (Windows key-repeat).
                if input_name == target_input:
                    return

                now = time.perf_counter()
                held_ms = (now - self.hold_started_at) * 1000
                if held_ms >= float(target_hold_ms):
                    # Auto-complete the hold and then re-evaluate this same input against the next step.
                    self._complete_hold(now, auto=True)
                    continue

            break

        # 1. Start of Combo
        if self.current_index == 0:
            if input_name == target_input:
                now = time.perf_counter()
                self._insert_attempt_separator()
                self.start_time = now
                self.last_input_time = now

                if target_hold_ms is None:
                    self.record_hit(input_name, 0, 0)
                    self.current_index += 1
                    self._maybe_start_wait_step()
                    self.update_status("Recording...", "green")
                else:
                    self._start_hold(input_name, target_hold_ms, now)
            else:
                pass # Ignore random inputs before start

        # 2. During Combo
        else:
            current_time = time.perf_counter()
            
            if input_name == target_input:
                if target_hold_ms is None:
                    # HIT (press)
                    split_ms = (current_time - self.last_input_time) * 1000
                    total_ms = (current_time - self.start_time) * 1000

                    self.record_hit(input_name, split_ms, total_ms)

                    self.last_input_time = current_time
                    self.current_index += 1
                    self._maybe_start_wait_step()

                    if self.current_index >= len(self.active_combo_steps):
                        self.update_status(f"Combo '{self.active_combo_name}' Complete!", "green")
                        self.current_index = 0
                else:
                    # Start holding; completion happens on release.
                    self._start_hold(input_name, target_hold_ms, current_time)
            else:
                # MISS
                if self._is_combo_ender(input_name):
                    # Allow spamming this ender key within its grace window after progress.
                    if self._within_ender_grace(input_name):
                        return
                    self.tree.insert("", "end", values=(f"{input_name} (Exp: {target_input})", "FAIL", "FAIL"))
                    self.update_status("Combo Dropped (Wrong Input)", "red")
                    self.tree.yview_moveto(1)
                    self.current_index = 0
                    self._reset_hold_state()
                else:
                    # Non-ender inputs are ignored (useful for games where many keys do nothing).
                    return

    def process_release(self, input_name):
        """Handle key/button release events for hold-steps."""
        self.currently_pressed.discard(input_name)
        if not self.active_combo_steps:
            return

        step = self._active_step()
        if not step:
            return

        target_input = step["input"]
        target_hold_ms = step["hold_ms"]

        if target_hold_ms is None:
            return

        if not self.hold_in_progress or self.hold_expected_input != input_name:
            return

        if input_name != target_input:
            return

        now = time.perf_counter()
        self._complete_hold(now, auto=False)

    # --- Event Callbacks ---

    def on_key_press(self, key):
        key_name = self.normalize_key(key)
        # Schedule the logic on the main thread (Tkinter isn't thread-safe)
        self.root.after(0, lambda: self.process_press(key_name))

    def on_key_release(self, key):
        key_name = self.normalize_key(key)
        self.root.after(0, lambda: self.process_release(key_name))

    def on_mouse_click(self, x, y, button, pressed):
        btn_name = self.normalize_mouse(button)
        if pressed:
            self.root.after(0, lambda: self.process_press(btn_name))
        else:
            self.root.after(0, lambda: self.process_release(btn_name))

    # --- GUI Helpers ---

    def new_combo(self):
        """Clear editor fields and deselect active combo (start a new preset)."""
        self.active_combo_name = None
        self.active_combo_tokens = []
        self.active_combo_steps = []
        self.combo_selector.set("")
        self.entry_name.delete(0, tk.END)
        self.entry_keys.delete(0, tk.END)
        self.reset_tracking()
        self.lbl_status.config(text="Status: Select a combo to start", fg="gray")

    def save_combo(self):
        name = self.entry_name.get().strip()
        keys_str = self.entry_keys.get().strip()
        
        if not name or not keys_str:
            messagebox.showerror("Error", "Please fill in Name and Inputs.")
            return

        # Parse inputs (comma-separated, but respect hold(e,0.2) commas)
        input_list = [k.strip().lower() for k in self.split_inputs(keys_str) if k.strip()]
        if not input_list:
            messagebox.showerror("Error", "Please provide at least one input.")
            return

        # If editing an existing combo and the name changed, treat this as rename.
        old_name = self.active_combo_name if self.active_combo_name in self.combos else None
        if old_name and name != old_name:
            if name in self.combos:
                ok = messagebox.askyesno(
                    "Overwrite?",
                    f"A combo named '{name}' already exists.\nOverwrite it?",
                )
                if not ok:
                    return
                # Overwrite existing target name; delete old key afterwards.
            self.combos[name] = input_list
            if old_name != name and old_name in self.combos:
                del self.combos[old_name]
        else:
            # Creating new OR updating an existing combo with same name
            if name in self.combos and not old_name:
                ok = messagebox.askyesno(
                    "Overwrite?",
                    f"A combo named '{name}' already exists.\nOverwrite it?",
                )
                if not ok:
                    return
            self.combos[name] = input_list
        
        self.combo_selector['values'] = list(self.combos.keys())
        self.combo_selector.set(name)
        self.set_active_combo(None)
        self.save_combos()
        
    def set_active_combo(self, event):
        name = self.combo_selector.get()
        if name in self.combos:
            self.active_combo_name = name
            self.active_combo_tokens = self.combos[name]
            steps = []
            for t in self.active_combo_tokens:
                s = self.parse_step(t)
                if s:
                    steps.append(s)
            self.active_combo_steps = steps

            # Populate editor fields for easy editing.
            self.entry_name.delete(0, tk.END)
            self.entry_name.insert(0, name)
            self.entry_keys.delete(0, tk.END)
            self.entry_keys.insert(0, ", ".join(self.active_combo_tokens))

            self.reset_tracking()
            first = self.active_combo_steps[0]
            start_key = first["input"].upper()
            if first["hold_ms"] is None:
                self.lbl_status.config(text=f"Ready! Press '{start_key}' to start.", fg="blue")
            else:
                self.lbl_status.config(text=f"Ready! Hold '{start_key}' for {first['hold_ms']}ms to start.", fg="blue")

    def delete_active_combo(self):
        name = self.combo_selector.get().strip()
        if not name or name not in self.combos:
            messagebox.showerror("Error", "Select a combo to delete.")
            return

        ok = messagebox.askyesno("Delete Combo?", f"Delete '{name}'? This cannot be undone.")
        if not ok:
            return

        del self.combos[name]
        self.combo_selector["values"] = list(self.combos.keys())
        self.save_combos()
        self.new_combo()

    def reset_tracking(self):
        self.current_index = 0
        self.start_time = 0
        self.last_input_time = 0
        self.attempt_counter = 0
        self._reset_hold_state()
        self._reset_wait_state()
        for item in self.tree.get_children():
            self.tree.delete(item)

    def record_hit(self, name, split, total):
        self.tree.insert("", "end", values=(name, f"{split:.1f}", f"{total:.1f}"))
        self.tree.yview_moveto(1)

    def update_status(self, text, color):
        self.lbl_status.config(text=text, fg=color)

    # --- Persistence Helpers ---

    def _get_data_dir(self) -> Path:
        """
        Save alongside the script/exe (same directory as the app).
        """
        if getattr(sys, "frozen", False):
            # PyInstaller exe
            return Path(sys.executable).resolve().parent
        return Path(__file__).resolve().parent

    def load_combos(self):
        try:
            if not self.save_path.exists():
                return

            data = json.loads(self.save_path.read_text(encoding="utf-8"))
            combos = data.get("combos", {})
            if isinstance(combos, dict):
                # sanitize to {str: [str, ...]}
                sanitized = {}
                for name, seq in combos.items():
                    if not isinstance(name, str) or not isinstance(seq, list):
                        continue
                    sanitized[name] = [str(x).strip().lower() for x in seq if str(x).strip()]
                self.combos = sanitized

            self.combo_selector["values"] = list(self.combos.keys())

            enders = data.get("combo_enders", {})
            parsed = {}
            if isinstance(enders, dict):
                for k, v in enders.items():
                    key = str(k).strip().lower()
                    if not key:
                        continue
                    try:
                        ms = int(float(v))
                    except Exception:
                        ms = 0
                    parsed[key] = max(0, ms)
            elif isinstance(enders, list):
                for x in enders:
                    key = str(x).strip().lower()
                    if key:
                        parsed[key] = 0
            self.combo_enders = parsed

            # Populate the settings UI
            self.entry_enders.delete(0, tk.END)
            if self.combo_enders:
                parts = []
                for k in sorted(self.combo_enders.keys()):
                    ms = int(self.combo_enders[k])
                    if ms > 0:
                        parts.append(f"{k}:{ms/1000.0:.3g}")
                    else:
                        parts.append(k)
                self.entry_enders.insert(0, ", ".join(parts))

            last_active = data.get("last_active_combo")
            if last_active in self.combos:
                self.combo_selector.set(last_active)
                self.set_active_combo(None)
        except Exception:
            # If the save file is corrupt or unreadable, just start fresh.
            self.combos = {}
            self.combo_selector["values"] = []

    def save_combos(self):
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            payload = {
                "version": 1,
                "last_active_combo": self.active_combo_name,
                "combos": self.combos,
                "combo_enders": dict(self.combo_enders),
            }
            self.save_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception:
            # Saving is best-effort; don't crash the UI on close.
            pass

    def apply_enders(self):
        """
        Read the combo enders list from the UI.
        Format: q:0.2,e:0.2,r:5.0,lmb,1:1.0,2:1.0,3:1.0, space
        - If a timing is omitted for a key, it gets 0 seconds (no grace).
        """
        raw = self.entry_enders.get().strip()
        if not raw:
            self.combo_enders = {}
            self.save_combos()
            self.update_status("Combo enders cleared (no keys will end the combo).", "gray")
            return

        parsed = {}
        for token in self.split_inputs(raw):
            t = token.strip()
            if not t:
                continue

            if ":" in t:
                k, v = t.split(":", 1)
                key = k.strip().lower()
                if not key:
                    continue
                try:
                    sec = float(v.strip())
                except ValueError:
                    messagebox.showerror("Error", f"Invalid timing for '{key}'. Use seconds, e.g. {key}:0.2")
                    return
                parsed[key] = max(0, int(sec * 1000))
            else:
                key = t.strip().lower()
                if key:
                    parsed[key] = 0

        self.combo_enders = parsed
        self.save_combos()
        self.update_status("Combo enders applied.", "gray")

    def on_close(self):
        # Stop listeners first (they run off-thread) to avoid input callbacks after teardown.
        try:
            self.key_listener.stop()
        except Exception:
            pass
        try:
            self.mouse_listener.stop()
        except Exception:
            pass

        self.save_combos()
        self.root.destroy()

if __name__ == "__main__":
    root = tk.Tk()
    app = ComboTrackerApp(root)
    root.mainloop()
