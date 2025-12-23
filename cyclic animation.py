import bpy
from bpy.props import PointerProperty, EnumProperty
from bpy.types import PropertyGroup, Operator, Panel

# This blender script allows the user to take any cyclic animation and repeat it using a custom rate/time curve.
# - make your cyclic animation
# - make a curve object and edit the curve in edit mode. then the script can read that data as rate/time based on the vert positions.
# - select both the source animation and curve object and the script will generate and bake a new action

# ============================================================================ #
# HELPER FUNCTIONS (Blender 5.0 Compatibility)
# ============================================================================ #

def get_action_fcurves(action):
    """Retrieves F-Curves handling both legacy and Blender 5.0+ Layered Actions."""
    # Legacy API (Blender < 4.5)
    if hasattr(action, "fcurves"):
        return action.fcurves
    
    # Layered API (Blender 5.0+)
    fcurves = []
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                # Iterate channelbags if available (standard 5.0 structure)
                if hasattr(strip, "channelbags"):
                    for bag in strip.channelbags:
                        for fc in bag.fcurves:
                            fcurves.append(fc)
                # Fallback
                elif hasattr(strip, "fcurves"):
                     for fc in strip.fcurves:
                        fcurves.append(fc)
    return fcurves

def ensure_fcurve(action, datablock, data_path, index=0):
    """Creates/Ensures an F-Curve exists, handling API differences."""
    # Legacy API
    if hasattr(action, "fcurves"):
        for fc in action.fcurves:
            if fc.data_path == data_path and fc.array_index == index:
                return fc
        return action.fcurves.new(data_path=data_path, index=index)
    
    # Blender 5.0+ API
    if hasattr(action, "fcurve_ensure_for_datablock"):
        return action.fcurve_ensure_for_datablock(datablock, data_path, index=index)
    
    return None

# ============================================================================ #
# PROPERTY GROUP
# ============================================================================ #

class VariablePlaybackProps(PropertyGroup):
    source_object: PointerProperty(
        name="Source Object",
        type=bpy.types.Object,
        description="Object containing the cyclic action to bake"
    )
    
    source_action: EnumProperty(
        name="Source Action",
        description="Select action to remap",
        items=lambda self, context: self.get_action_items(context)
    )
    
    bpm_curve: PointerProperty(
        name="BPM Curve",
        type=bpy.types.Object,
        description="Curve object with X=time(min), Y=rate(BPM)"
    )
    
    def get_action_items(self, context):
        items = []
        if not self.source_object:
            items.append(("NONE", "No object selected", ""))
            return items
        
        actions = set()
        
        # Check object-level animation
        if self.source_object.animation_data:
            if self.source_object.animation_data.nla_tracks:
                for track in self.source_object.animation_data.nla_tracks:
                    for strip in track.strips:
                        if strip.action: actions.add(strip.action.name)
            if self.source_object.animation_data.action:
                actions.add(self.source_object.animation_data.action.name)
        
        # Check shape-key animation
        if (self.source_object.data and hasattr(self.source_object.data, 'shape_keys') and
            self.source_object.data.shape_keys and self.source_object.data.shape_keys.animation_data):
            sk_anim = self.source_object.data.shape_keys.animation_data
            if sk_anim.nla_tracks:
                for track in sk_anim.nla_tracks:
                    for strip in track.strips:
                        if strip.action: actions.add(strip.action.name)
            if sk_anim.action:
                actions.add(sk_anim.action.name)
        
        if actions:
            for action_name in sorted(actions):
                items.append((action_name, action_name, ""))
        else:
            items.append(("NONE", "No actions found", ""))
        return items

# ============================================================================ #
# UI PANEL
# ============================================================================ #

class VARIABLEPLAYBACK_PT_panel(Panel):
    bl_label = "Variable Playback Baker"
    bl_idname = "VARIABLEPLAYBACK_PT_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Animation"
    
    def draw(self, context):
        layout = self.layout
        props = context.scene.variable_playback_props
        
        layout.prop(props, "source_object", icon='OBJECT_DATA')
        
        has_anim_data = False
        if props.source_object:
            if props.source_object.animation_data: has_anim_data = True
            if (props.source_object.data and hasattr(props.source_object.data, 'shape_keys') and
                props.source_object.data.shape_keys and props.source_object.data.shape_keys.animation_data):
                has_anim_data = True
        
        if props.source_object and has_anim_data:
            layout.prop(props, "source_action", icon='ACTION')
            if props.source_action and props.source_action != "NONE":
                action = bpy.data.actions.get(props.source_action)
                if action:
                    col = layout.column(align=True)
                    # Safe frame range access for 5.0
                    if hasattr(action, "frame_range"): fr = action.frame_range
                    elif hasattr(action, "curve_frame_range"): fr = action.curve_frame_range
                    else: fr = (0,0)
                    
                    col.label(text=f"Frames: {fr[0]:.0f} - {fr[1]:.0f}", icon='TIME')
                    dur = (fr[1] - fr[0]) / context.scene.render.fps if context.scene.render.fps else 0
                    col.label(text=f"Duration: {dur:.2f}s", icon='PLAY')
        else:
            layout.label(text="Select an object with animation data", icon='INFO')
        
        layout.separator()
        layout.prop(props, "bpm_curve", icon='CURVE_DATA')
        
        box = layout.box()
        box.label(text="Output Frame Range", icon='PREVIEW_RANGE')
        col = box.column(align=True)
        col.prop(context.scene, "frame_start", text="Start")
        col.prop(context.scene, "frame_end", text="End")
        
        if "variable_playback_time_rate_pairs" in context.scene:
            pairs = context.scene["variable_playback_time_rate_pairs"]
            box = layout.box()
            box.label(text=f"Data Loaded: {len(pairs)} points", icon='CHECKMARK')
            if len(pairs) > 0:
                col = box.column(align=True)
                col.label(text="First points:", icon='DOT')
                for i in range(min(3, len(pairs))):
                    t, bpm = pairs[i]
                    col.label(text=f"  t={t:.2f}s, BPM={bpm:.1f}")
        
        col = layout.column(align=True)
        col.operator("variable_playback.read_curve", icon='IMPORT')
        row = col.row(align=True)
        row.operator("variable_playback.preview", icon='MONKEY')
        row.enabled = "variable_playback_time_rate_pairs" in context.scene
        row = col.row(align=True)
        row.operator("variable_playback.bake", icon='REC')
        row.enabled = "variable_playback_time_rate_pairs" in context.scene

# ============================================================================ #
# OPERATORS
# ============================================================================ #

class VARIABLEPLAYBACK_OT_read_curve(Operator):
    """Read BPM/time data from selected curve by converting to mesh"""
    bl_idname = "variable_playback.read_curve"
    bl_label = "Read BPM Data"
    bl_description = "Duplicate curve, convert to mesh, and read high-res data"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.variable_playback_props
        
        # 1. Validation
        if not props.bpm_curve:
            self.report({'ERROR'}, "No BPM curve selected")
            return {'CANCELLED'}
            
        src_obj = props.bpm_curve
        if src_obj.type != 'CURVE':
             self.report({'ERROR'}, "Selected object is not a curve")
             return {'CANCELLED'}

        # Store selection to restore later
        prev_active = context.view_layer.objects.active
        prev_selected = context.selected_objects
        
        temp_obj = None
        temp_mesh = None
        
        try:
            # 2. Duplicate Object
            # We copy the object to preserve the original.
            # We also copy data to ensure no accidental linking issues, though Convert consumes it.
            temp_obj = src_obj.copy()
            temp_obj.data = src_obj.data.copy() 
            
            # Link to scene collection so we can operate on it
            context.scene.collection.objects.link(temp_obj)
            
            # 3. Select ONLY the temp object
            bpy.ops.object.select_all(action='DESELECT')
            temp_obj.select_set(True)
            context.view_layer.objects.active = temp_obj
            
            # 4. Convert to Mesh
            # This 'bakes' the Bezier/Nurbs math into real vertices based on the curve's Resolution U
            bpy.ops.object.convert(target='MESH')
            
            # 5. Read Data from Mesh
            mesh = temp_obj.data
            temp_mesh = mesh # reference for cleanup
            verts = mesh.vertices
            
            if len(verts) < 2:
                self.report({'ERROR'}, "Curve resolved to fewer than 2 vertices")
                return {'CANCELLED'}
            
            IMPORT_X_SCALE = 1 / 60.0
            IMPORT_Y_SCALE = 1 / 100.0
            
            time_rate_pairs = []
            
            # Read vertices (which are now densely populated along the curve path)
            for v in verts:
                x, y = v.co.x, v.co.y
                
                time_seconds = x / IMPORT_X_SCALE
                bpm = y / IMPORT_Y_SCALE
                
                # Optional: Skip negative time if desired, or just warn
                if time_seconds < 0:
                    continue
                
                time_rate_pairs.append((time_seconds, bpm))
            
            # 6. Sort and Validate
            # Conversion usually preserves order, but sorting by Time (X) is safest
            time_rate_pairs.sort(key=lambda k: k[0])
            
            # Remove duplicates or non-monotonic points (floating point jitters)
            clean_pairs = []
            last_t = -1.0
            for t, bpm in time_rate_pairs:
                if t > last_t:
                    clean_pairs.append((t, bpm))
                    last_t = t
            
            context.scene["variable_playback_time_rate_pairs"] = clean_pairs
            self.report({'INFO'}, f"Sampled {len(clean_pairs)} points from curve.")
            
        except Exception as e:
            self.report({'ERROR'}, f"Error processing curve: {str(e)}")
            return {'CANCELLED'}
            
        finally:
            # 7. Cleanup
            # Delete the temp object and its mesh data
            if temp_obj:
                try:
                    bpy.data.objects.remove(temp_obj, do_unlink=True)
                except:
                    pass
            if temp_mesh:
                try:
                    bpy.data.meshes.remove(temp_mesh, do_unlink=True)
                except:
                    pass
            
            # Restore previous selection
            if prev_selected:
                for obj in prev_selected:
                    try: obj.select_set(True)
                    except: pass
            if prev_active:
                context.view_layer.objects.active = prev_active

        return {'FINISHED'}

class VARIABLEPLAYBACK_OT_preview(Operator):
    """Create preview visualization showing phase and rate"""
    bl_idname = "variable_playback.preview"
    bl_label = "Preview"
    bl_description = "Create empty that visualizes loop phase (X) and rate (Y)"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.variable_playback_props
        pairs = context.scene.get("variable_playback_time_rate_pairs")
        
        if not pairs:
            self.report({'ERROR'}, "No curve data loaded")
            return {'CANCELLED'}
        
        name = "VariablePlayback_Preview"
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
        
        bpy.ops.object.empty_add()
        preview_obj = context.active_object
        preview_obj.name = name
        preview_obj.empty_display_size = 2.0
        
        def sample_bpm(time_seconds):
            if time_seconds <= pairs[0][0]: return pairs[0][1]
            if time_seconds >= pairs[-1][0]: return pairs[-1][1]
            for i in range(len(pairs) - 1):
                t0, bpm0 = pairs[i]
                t1, bpm1 = pairs[i + 1]
                if t0 <= time_seconds <= t1:
                    factor = (time_seconds - t0) / (t1 - t0)
                    return bpm0 + factor * (bpm1 - bpm0)
            return pairs[-1][1]
        
        action_name = "VariablePlayback_Preview_Action"
        if action_name in bpy.data.actions:
            bpy.data.actions.remove(bpy.data.actions[action_name])
        
        action = bpy.data.actions.new(name=action_name)
        
        # 5.0 Fix: Assign action first
        if not preview_obj.animation_data:
            preview_obj.animation_data_create()
        preview_obj.animation_data.action = action
        
        phase_fcurve = ensure_fcurve(action, preview_obj, "location", 0)
        rate_fcurve = ensure_fcurve(action, preview_obj, "location", 1)
        
        if not phase_fcurve or not rate_fcurve:
            self.report({'ERROR'}, "Could not create F-Curves (Blender Version Mismatch?)")
            return {'CANCELLED'}
            
        fps = context.scene.render.fps
        phase = 0.0
        
        for frame in range(context.scene.frame_start, context.scene.frame_end + 1):
            t = frame / fps
            bpm = sample_bpm(t)
            rate = max(bpm, 0.0) / 60.0
            phase += rate * (1.0 / fps)
            
            normalized_phase = phase % 1.0
            phase_fcurve.keyframe_points.insert(frame, normalized_phase * 5.0, options={'FAST'})
            rate_fcurve.keyframe_points.insert(frame, min(rate, 2.0), options={'FAST'})
        
        self.report({'INFO'}, f"Preview created: {name} (X=phase, Y=rate)")
        return {'FINISHED'}

class VARIABLEPLAYBACK_OT_bake(Operator):
    """Bake variable-rate animation"""
    bl_idname = "variable_playback.bake"
    bl_label = "Bake"
    bl_description = "Bake variable playback into new action"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.variable_playback_props
        pairs = context.scene.get("variable_playback_time_rate_pairs")
        
        if not pairs:
            self.report({'ERROR'}, "No curve data loaded")
            return {'CANCELLED'}
        if not props.source_object or not props.source_action or props.source_action == "NONE":
            self.report({'ERROR'}, "Select source object and action")
            return {'CANCELLED'}
        
        src_action = bpy.data.actions.get(props.source_action)
        if not src_action:
            self.report({'ERROR'}, "Action not found")
            return {'CANCELLED'}
        
        src_fcurves = get_action_fcurves(src_action)
        if len(src_fcurves) == 0:
            self.report({'ERROR'}, "Action has no animation curves")
            return {'CANCELLED'}
        
        is_shape_key_action = False
        if (props.source_object.data and hasattr(props.source_object.data, 'shape_keys') and
            props.source_object.data.shape_keys and props.source_object.data.shape_keys.animation_data and
            props.source_object.data.shape_keys.animation_data.action == src_action):
            is_shape_key_action = True
            
        target_datablock = props.source_object.data.shape_keys if is_shape_key_action else props.source_object
        
        suffix = "_ShapeKeys" if is_shape_key_action else ""
        baked_name = f"{props.source_object.name}_{src_action.name}_Baked{suffix}"
        
        if baked_name in bpy.data.actions:
            bpy.data.actions.remove(bpy.data.actions[baked_name])
        
        baked_action = bpy.data.actions.new(name=baked_name)
        
        # 5.0 Fix: Assign action first
        if not target_datablock.animation_data:
            target_datablock.animation_data_create()
        
        # Temporarily assign to create curves
        prev_action = target_datablock.animation_data.action
        target_datablock.animation_data.action = baked_action
        
        # Safe frame range access
        if hasattr(src_action, "frame_range"): src_start, src_end = src_action.frame_range
        elif hasattr(src_action, "curve_frame_range"): src_start, src_end = src_action.curve_frame_range
        else: src_start, src_end = (0, 100)
            
        src_duration = src_end - src_start
        if src_duration == 0:
            self.report({'ERROR'}, "Source action has zero duration")
            return {'CANCELLED'}
        
        def sample_bpm(time_seconds):
            if time_seconds <= pairs[0][0]: return pairs[0][1]
            if time_seconds >= pairs[-1][0]: return pairs[-1][1]
            for i in range(len(pairs) - 1):
                t0, bpm0 = pairs[i]
                t1, bpm1 = pairs[i + 1]
                if t0 <= time_seconds <= t1:
                    factor = (time_seconds - t0) / (t1 - t0)
                    return bpm0 + factor * (bpm1 - bpm0)
            return pairs[-1][1]
        
        baked_fcurves = {}
        for src_fc in src_fcurves:
            baked_fc = ensure_fcurve(baked_action, target_datablock, src_fc.data_path, src_fc.array_index)
            if baked_fc:
                baked_fcurves[(src_fc.data_path, src_fc.array_index)] = baked_fc
        
        fps = context.scene.render.fps
        phase = 0.0
        frame_start = context.scene.frame_start
        frame_end = context.scene.frame_end
        
        wm = context.window_manager
        wm.progress_begin(0, frame_end - frame_start)
        
        for frame in range(frame_start, frame_end + 1):
            wm.progress_update(frame - frame_start)
            t = frame / fps
            bpm = sample_bpm(t)
            rate = max(bpm, 0.0) / 60.0
            phase += rate * (1.0 / fps)
            
            normalized_phase = phase % 1.0
            src_frame = src_start + normalized_phase * src_duration
            
            for src_fc in src_fcurves:
                if (src_fc.data_path, src_fc.array_index) in baked_fcurves:
                    value = src_fc.evaluate(src_frame)
                    baked_fc = baked_fcurves[(src_fc.data_path, src_fc.array_index)]
                    baked_fc.keyframe_points.insert(frame, value, options={'FAST'})
        
        wm.progress_end()
        baked_action.use_fake_user = True
        self.report({'INFO'}, f"Baked {frame_end - frame_start + 1} frames to '{baked_name}'")
        return {'FINISHED'}

classes = (
    VariablePlaybackProps,
    VARIABLEPLAYBACK_PT_panel,
    VARIABLEPLAYBACK_OT_read_curve,
    VARIABLEPLAYBACK_OT_preview,
    VARIABLEPLAYBACK_OT_bake,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.variable_playback_props = PointerProperty(type=VariablePlaybackProps)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.variable_playback_props

if __name__ == "__main__":
    register()