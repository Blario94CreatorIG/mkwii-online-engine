/**
 * Built-in course and character workspaces. Assets stay local to the browser unless exported.
 * Supported model imports: glTF/GLB, OBJ, FBX, STL and PLY.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';

type EditorTab = 'course' | 'character';
type ModelSlot = 'course' | 'character' | 'kart' | 'tires';

const ACCEPTED = '.glb,.gltf,.obj,.fbx,.stl,.ply,.dae';

export class Editors {
    private readonly root = document.createElement('section');
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    private readonly models: Record<ModelSlot, THREE.Object3D | null> = { course: null, character: null, kart: null, tires: null };
    private readonly modelFiles: Partial<Record<ModelSlot, File>> = {};
    private readonly audio = new Audio();
    private readonly urls: string[] = [];
    private readonly lights = new THREE.Group();
    private readonly content = document.createElement('div');
    private readonly canvas = this.renderer.domElement;
    private tab: EditorTab = 'course';
    private selectedPrimitive = 'box';
    private readonly courseObjects: THREE.Object3D[] = [];
    private backgroundUrl = '';
    private musicUrl = '';
    private status!: HTMLElement;
    private disposed = false;
    private selected: THREE.Object3D | null = null;
    private mixers: THREE.AnimationMixer[] = [];
    private selectedAnimations: THREE.AnimationClip[] = [];
    private clock = new THREE.Clock();
    private textureUrls: string[] = [];
    private textureTarget = -1;
    private lightIntensity = 2.5;
    private ambientIntensity = 2;
    private keyLight!: THREE.DirectionalLight;
    private ambientLight!: THREE.HemisphereLight;

    constructor(
        private readonly onClose: () => void,
        private readonly onAudioFile: (kind: 'countdown' | 'fanfare', file: File) => void,
        private readonly onTextureFile: (file: File, index: number) => void,
        private readonly onCourseMusicFile: (file: File) => void,
    ) {
        this.root.className = 'game-editors';
        this.root.hidden = true;
        this.scene.background = new THREE.Color('#b9c8d2');
        this.camera.position.set(7, 6, 9);
        this.camera.lookAt(0, 0, 0);
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(800, 480);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.ambientLight = new THREE.HemisphereLight(0xffffff, 0x59636c, this.ambientIntensity);
        this.keyLight = new THREE.DirectionalLight(0xffffff, this.lightIntensity);
        this.keyLight.position.set(5, 10, 7);
        this.scene.add(this.ambientLight, this.keyLight, this.lights);
        const grid = new THREE.GridHelper(30, 30, 0x63717a, 0xaab4bb);
        this.scene.add(grid);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x89979d, roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.02;
        this.scene.add(floor);
        this.root.append(this.buildHeader(), this.buildToolbar(), this.canvas, this.content);
        this.status = document.createElement('p');
        this.status.className = 'editor-status';
        this.root.append(this.status);
        document.body.append(this.root);
        this.showTab('course');
        this.animate();
        window.addEventListener('resize', this.resize);
        this.canvas.addEventListener('dragover', this.dragOver);
        this.canvas.addEventListener('drop', this.dropOnCanvas);
    }

    open(tab: EditorTab = 'course'): void {
        this.root.hidden = false;
        this.showTab(tab);
        this.resize();
    }

    close(): void {
        this.root.hidden = true;
        this.audio.pause();
        this.onClose();
    }

    private buildHeader(): HTMLElement {
        const header = document.createElement('header');
        header.className = 'editor-header';
        const title = document.createElement('strong');
        title.textContent = 'GAME EDITORS';
        const close = document.createElement('button');
        close.textContent = 'Back to pause menu';
        close.onclick = () => this.close();
        header.append(title, close);
        return header;
    }

    private buildToolbar(): HTMLElement {
        const bar = document.createElement('nav');
        bar.className = 'editor-tabs';
        for (const [tab, label] of [['course', 'Course Editor'], ['character', 'Character Editor']] as const) {
            const b = document.createElement('button');
            b.textContent = label;
            b.onclick = () => this.showTab(tab);
            b.dataset.tab = tab;
            bar.append(b);
        }
        return bar;
    }

    private showTab(tab: EditorTab): void {
        this.tab = tab;
        this.root.querySelectorAll<HTMLButtonElement>('.editor-tabs button').forEach((b) => b.classList.toggle('selected', b.dataset.tab === tab));
        this.content.replaceChildren(tab === 'course' ? this.coursePanel() : this.characterPanel());
        this.refreshPreview();
    }

    private coursePanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'editor-panel';
        panel.innerHTML = '';
        const heading = document.createElement('h2');
        heading.textContent = 'Build a course';
        const hint = document.createElement('p');
        hint.textContent = 'Drop a 3D model onto the preview, import a model, or add basic track pieces.';
        const actions = document.createElement('div');
        actions.className = 'editor-actions';
        actions.append(this.fileButton('Import course model', 'course'), this.actionButton('Add road', () => this.addPrimitive('road')), this.actionButton('Add ramp', () => this.addPrimitive('ramp')), this.actionButton('Add scenery box', () => this.addPrimitive('box')), this.actionButton('Clear course', () => this.clearCourse()));
        const appearance = this.appearancePanel();
        const skybox = this.fileInput('image/*', (file) => this.setSkybox(file));
        const courseMusic = this.fileInput('audio/*', (file) => this.onCourseMusicFile(file));
        const courseSettings = document.createElement('div');
        courseSettings.className = 'editor-settings';
        const settingsTitle = document.createElement('h3');
        settingsTitle.textContent = 'Course atmosphere';
        courseSettings.append(settingsTitle, this.field('Course skybox image', skybox), this.field('Course music', courseMusic));
        const exportButton = this.actionButton('Export course scene', () => this.exportScene());
        panel.append(heading, hint, actions, this.transformPanel(), this.materialPanel(), this.lightingPanel(), courseSettings, appearance, exportButton);
        return panel;
    }

    private characterPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'editor-panel';
        const heading = document.createElement('h2');
        heading.textContent = 'Customise your character';
        const hint = document.createElement('p');
        hint.textContent = 'Import a character model, then add optional kart and tire models. Drag and drop model files onto the preview.';
        const actions = document.createElement('div');
        actions.className = 'editor-actions';
        actions.append(
            this.fileButton('Character model', 'character'),
            this.fileButton('Custom kart model', 'kart'),
            this.fileButton('Custom tire model', 'tires'),
        );
        const audio = this.audioPanel();
        const appearance = this.appearancePanel();
        panel.append(heading, hint, actions, this.transformPanel(), this.materialPanel(), this.animationPanel(), this.lightingPanel(), audio, appearance, this.actionButton('Export character setup', () => this.exportCharacter()));
        return panel;
    }

    private transformPanel(): HTMLElement {
        const wrap = document.createElement('section');
        wrap.className = 'editor-settings editor-toolbox';
        const title = document.createElement('h3'); title.textContent = 'Object transform';
        const select = document.createElement('select'); select.setAttribute('aria-label', 'Select object to edit');
        const refresh = () => {
            select.replaceChildren(new Option('Select an object…', ''));
            const objects: THREE.Object3D[] = [];
            if (this.tab === 'course') objects.push(...this.courseObjects, ...(this.models.course ? [this.models.course] : []));
            else for (const slot of ['character','kart','tires'] as const) if (this.models[slot]) objects.push(this.models[slot]!);
            objects.forEach((o, i) => select.add(new Option(o.name || `Object ${i+1}`, String(i))));
            if (this.selected && objects.includes(this.selected)) select.value = String(objects.indexOf(this.selected));
            select.onchange = () => { this.selected = objects[Number(select.value)] ?? null; populate(); this.refreshTransformValues(wrap); };
        };
        const controls = document.createElement('div'); controls.className = 'editor-transform-grid';
        const make = (label: string, axis: 'x'|'y'|'z', group: 'position'|'rotation'|'scale', value: number) => {
            const field = document.createElement('label'); field.className = 'editor-field';
            const caption = document.createElement('span'); caption.textContent = label;
            const input = document.createElement('input'); input.type = 'number'; input.step = group === 'rotation' ? '5' : '0.1'; input.value = String(Number(value.toFixed(2)));
            input.oninput = () => { if (!this.selected) return; const v = Number(input.value) || 0; if (group === 'rotation') this.selected.rotation[axis] = THREE.MathUtils.degToRad(v); else if (group === 'position') this.selected.position[axis] = v; else this.selected.scale[axis] = Math.max(0.01, v); this.refreshPreview(); };
            field.append(caption,input); return field;
        };
        const populate = () => {
            controls.replaceChildren();
            const o = this.selected;
            const addGroup = (name: string, group: 'position'|'rotation'|'scale', vals: number[]) => {
                const heading = document.createElement('strong'); heading.className='editor-control-heading'; heading.textContent=name; controls.append(heading);
                (['x','y','z'] as const).forEach((axis,i)=>controls.append(make(axis.toUpperCase(),axis,group,vals[i]!)));
            };
            if (!o) { controls.textContent = 'Choose a model or course piece to edit its position, rotation and dimensions.'; return; }
            addGroup('Move', 'position', [o.position.x,o.position.y,o.position.z]);
            addGroup('Rotate (degrees)', 'rotation', [THREE.MathUtils.radToDeg(o.rotation.x),THREE.MathUtils.radToDeg(o.rotation.y),THREE.MathUtils.radToDeg(o.rotation.z)]);
            addGroup('Size', 'scale', [o.scale.x,o.scale.y,o.scale.z]);
        };
        select.onfocus = refresh;
        wrap.append(title, this.field('Selected model / course piece', select), controls);
        refresh(); populate();
        const observer = new MutationObserver(() => { if (wrap.isConnected) { refresh(); if (!this.selected) populate(); } observer.disconnect(); });
        observer.observe(wrap, {childList:true,subtree:true});
        return wrap;
    }

    private refreshTransformValues(_wrap: HTMLElement): void {
        this.refreshPreview();
        this.status.textContent = this.selected ? `Editing ${this.selected.name || 'selected object'}.` : 'No object selected.';
    }

    private materialPanel(): HTMLElement {
        const wrap = document.createElement('section'); wrap.className='editor-settings';
        const title=document.createElement('h3'); title.textContent='Model textures & materials';
        const files=this.fileInput('image/*', (file)=>this.applyTexture(file));
        const meshSelect=document.createElement('select'); meshSelect.add(new Option('All meshes','-1'));
        this.selected?.traverse(node=>{if(node instanceof THREE.Mesh) meshSelect.add(new Option(node.name || `Mesh ${meshSelect.length}`,String(meshSelect.length-1)));});
        meshSelect.onchange=()=>{this.textureTarget=Number(meshSelect.value);};
        const multiple=document.createElement('input'); multiple.type='file'; multiple.accept='image/*'; multiple.multiple=true;
        multiple.onchange=()=>{Array.from(multiple.files??[]).forEach((file,i)=>this.applyTexture(file,i)); multiple.value='';};
        wrap.append(title,this.field('Target mesh',meshSelect),this.field('Apply texture image',files),this.field('Assign separate images (in mesh order)',multiple));
        const help=document.createElement('p'); help.textContent='Choose All meshes or a single mesh. Multiple images are assigned one per mesh in the order selected.'; wrap.append(help);
        return wrap;
    }

    private applyTexture(file: File, target = this.textureTarget): void {
        if (!this.selected) { this.status.textContent='Select a model first.'; return; }
        const url=URL.createObjectURL(file); this.textureUrls.push(url);
        new THREE.TextureLoader().load(url,(texture)=>{
            texture.colorSpace=THREE.SRGBColorSpace;
            let meshIndex=0;
            this.selected?.traverse((node)=>{
                if (!(node instanceof THREE.Mesh)) return;
                const apply = target < 0 || meshIndex === target;
                meshIndex++;
                if (!apply) return;
                const materials=Array.isArray(node.material)?node.material:[node.material];
                for(const material of materials){ material.map=texture; material.needsUpdate=true; }
            });
            this.status.textContent=`Applied ${file.name} to selected model.`;
        },undefined,()=>{ URL.revokeObjectURL(url); this.status.textContent=`Could not load ${file.name}.`; });
    }

    private animationPanel(): HTMLElement {
        const wrap=document.createElement('section'); wrap.className='editor-settings';
        const title=document.createElement('h3'); title.textContent='Character animation';
        const play=this.actionButton('Play animation',()=>this.playAnimation());
        const stop=this.actionButton('Stop animation',()=>{ for(const mixer of this.mixers) mixer.stopAllAction(); this.status.textContent='Animation stopped.'; });
        const hint=document.createElement('p'); hint.textContent='Plays animation clips embedded in the imported GLTF/GLB or DAE character file.';
        wrap.append(title,play,stop,hint); return wrap;
    }

    private playAnimation(): void {
        if (!this.selected) { this.status.textContent='Select the character model first.'; return; }
        if (!this.selectedAnimations.length) { this.status.textContent='This model file contains no embedded animation clips.'; return; }
        this.mixers.forEach(m=>m.stopAllAction()); this.mixers=[];
        const mixer=new THREE.AnimationMixer(this.selected); this.mixers.push(mixer);
        this.selectedAnimations.forEach(clip=>mixer.clipAction(clip).reset().play());
        this.status.textContent=`Playing ${this.selectedAnimations.length} animation clip(s).`;
    }

    private lightingPanel(): HTMLElement {
        const wrap=document.createElement('section'); wrap.className='editor-settings';
        const title=document.createElement('h3'); title.textContent='Preview lighting';
        const ambient=document.createElement('input'); ambient.type='range'; ambient.min='0'; ambient.max='5'; ambient.step='0.1'; ambient.value=String(this.ambientIntensity);
        ambient.oninput=()=>{this.ambientIntensity=Number(ambient.value);this.ambientLight.intensity=this.ambientIntensity;};
        const key=document.createElement('input'); key.type='range'; key.min='0'; key.max='8'; key.step='0.1'; key.value=String(this.lightIntensity);
        key.oninput=()=>{this.lightIntensity=Number(key.value);this.keyLight.intensity=this.lightIntensity;};
        const color=document.createElement('input'); color.type='color'; color.value='#ffffff';
        color.oninput=()=>this.keyLight.color.set(color.value);
        wrap.append(title,this.field('Ambient light',ambient),this.field('Directional light',key),this.field('Light colour',color));
        return wrap;
    }

    private appearancePanel(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'editor-settings';
        const title = document.createElement('h3');
        title.textContent = 'Editor background and music';
        const bg = this.fileInput('image/*', (file) => {
            this.revoke(this.backgroundUrl);
            this.backgroundUrl = URL.createObjectURL(file);
            this.root.style.backgroundImage = `linear-gradient(#10192399,#101923aa), url("${this.backgroundUrl}")`;
            this.root.style.backgroundSize = 'cover';
            this.root.style.backgroundPosition = 'center';
            this.status.textContent = 'Editor background updated.';
        });
        const music = this.fileInput('audio/*', (file) => this.setMusic(file));
        wrap.append(title, this.field('Background image', bg), this.field('Editor music', music));
        return wrap;
    }

    private audioPanel(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'editor-settings';
        const title = document.createElement('h3');
        title.textContent = 'Race audio customisation';
        const countdown = this.fileInput('audio/*', (file) => this.onAudioFile('countdown', file));
        const fanfare = this.fileInput('audio/*', (file) => this.onAudioFile('fanfare', file));
        const texture = this.fileInput('image/*', (file) => this.onTextureFile(file, 3));
        const texture2 = this.fileInput('image/*', (file) => this.onTextureFile(file, 2));
        const texture3 = this.fileInput('image/*', (file) => this.onTextureFile(file, 1));
        wrap.append(title, this.field('Countdown sound', countdown), this.field('Countdown texture — 3', texture), this.field('Countdown texture — 2', texture2), this.field('Countdown texture — 1', texture3), this.field('Race-start fanfare', fanfare));
        return wrap;
    }

    private field(label: string, input: HTMLElement): HTMLElement {
        const row = document.createElement('label');
        row.className = 'editor-field';
        const text = document.createElement('span');
        text.textContent = label;
        row.append(text, input);
        return row;
    }

    private fileInput(accept: string, onFile: (file: File) => void): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) onFile(file);
            input.value = '';
        };
        return input;
    }

    private fileButton(label: string, slot: ModelSlot): HTMLElement {
        const input = this.fileInput(ACCEPTED, (file) => void this.loadModel(file, slot));
        input.className = 'visually-hidden';
        const button = this.actionButton(label, () => input.click());
        button.append(input);
        return button;
    }

    private actionButton(label: string, action: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.textContent = label;
        button.onclick = action;
        return button;
    }

    private addPrimitive(kind: string): void {
        let geometry: THREE.BufferGeometry;
        let material = new THREE.MeshStandardMaterial({ color: kind === 'road' ? 0x39434a : kind === 'ramp' ? 0xe4a34c : 0x4f8c76, roughness: 0.82 });
        const mesh = new THREE.Mesh(kind === 'road' ? new THREE.BoxGeometry(12, 0.25, 3) : kind === 'ramp' ? new THREE.BoxGeometry(4, 0.5, 3) : new THREE.BoxGeometry(2, 2, 2), material);
        if (kind === 'road') mesh.position.y = 0.12;
        else if (kind === 'ramp') { mesh.position.set(0, 0.55, 0); mesh.rotation.z = -0.22; }
        else mesh.position.set((this.courseObjects.length % 4) * 2.5, 1, 0);
        this.courseObjects.push(mesh);
        this.scene.add(mesh);
        this.status.textContent = `Added ${kind} to the course scene.`;
    }

    private clearCourse(): void {
        for (const object of this.courseObjects) {
            this.scene.remove(object);
            this.disposeObject(object);
        }
        this.courseObjects.length = 0;
        this.removeModel('course');
        this.status.textContent = 'Course scene cleared.';
    }

    private async loadModel(file: File, slot: ModelSlot): Promise<void> {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        try {
            const buffer = await file.arrayBuffer();
            let object: THREE.Object3D;
            if (ext === 'glb' || ext === 'gltf') {
                object = await new Promise<THREE.Object3D>((resolve, reject) => new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject));
            } else if (ext === 'obj') {
                object = new OBJLoader().parse(new TextDecoder().decode(buffer));
            } else if (ext === 'fbx') {
                object = new FBXLoader().parse(buffer, '');
            } else if (ext === 'stl') {
                const geometry = new STLLoader().parse(buffer);
                geometry.computeVertexNormals();
                object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa9b3, metalness: 0.2, roughness: 0.65 }));
            } else if (ext === 'dae') {
                const collada = new ColladaLoader().parse(new TextDecoder().decode(buffer), '');
                object = collada.scene;
                this.selectedAnimations = collada.animations ?? [];
            } else if (ext === 'ply') {
                const geometry = new PLYLoader().parse(buffer);
                geometry.computeVertexNormals();
                object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa9b3, roughness: 0.7 }));
            } else {
                throw new Error('Unsupported model format. Use GLB, GLTF, OBJ, FBX, DAE, STL or PLY.');
            }
            this.removeModel(slot);
            this.modelFiles[slot] = file;
            object.name = `custom-${slot}`;
            object.scale.setScalar(1);
            const bounds = new THREE.Box3().setFromObject(object);
            const size = bounds.getSize(new THREE.Vector3());
            const max = Math.max(size.x, size.y, size.z) || 1;
            object.scale.multiplyScalar(4 / max);
            bounds.setFromObject(object);
            const center = bounds.getCenter(new THREE.Vector3());
            object.position.sub(center);
            if (slot === 'course') {
                this.scene.add(object);
                this.models.course = object;
            } else {
                this.models[slot] = object;
            }
            this.selected = object;
            this.refreshPreview();
            this.status.textContent = `Loaded ${file.name} into ${slot} slot. Select an object below to edit it.`;
        } catch (error) {
            this.status.textContent = error instanceof Error ? error.message : 'Could not load that model file.';
        }
    }

    private removeModel(slot: ModelSlot): void {
        const old = this.models[slot];
        if (old) {
            this.scene.remove(old);
            this.disposeObject(old);
            this.models[slot] = null;
        }
        delete this.modelFiles[slot];
    }

    private refreshPreview(): void {
        for (const child of [...this.lights.children]) this.lights.remove(child);
        if (this.tab === 'character') {
            for (const slot of ['character', 'kart', 'tires'] as const) {
                const model = this.models[slot];
                if (!model) continue;
                const clone = model.clone(true);
                if (slot === 'character') clone.position.add(new THREE.Vector3(0, 0, 0));
                this.lights.add(clone);
            }
        } else {
            for (const object of this.courseObjects) if (!this.scene.children.includes(object)) this.scene.add(object);
        }
    }

    private setSkybox(file: File): void {
        const url = URL.createObjectURL(file);
        this.urls.push(url);
        new THREE.TextureLoader().load(url, (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.background = texture;
            this.status.textContent = `Course skybox preview set to ${file.name}.`;
        }, undefined, () => {
            this.status.textContent = 'Could not load that skybox image.';
            URL.revokeObjectURL(url);
        });
    }

    private setMusic(file: File): void {
        this.revoke(this.musicUrl);
        this.musicUrl = URL.createObjectURL(file);
        this.audio.src = this.musicUrl;
        this.audio.loop = true;
        this.audio.volume = 0.35;
        void this.audio.play().then(() => { this.status.textContent = `Playing editor music: ${file.name}`; }).catch(() => { this.status.textContent = 'Music selected. Press the music control again after interacting with the page if playback was blocked.'; });
    }

    private exportScene(): void {
        const json = this.scene.toJSON();
        this.download('course-scene.json', JSON.stringify(json));
    }

    private exportCharacter(): void {
        const manifest = {
            format: 'sf-kart-character-editor-v1',
            slots: Object.fromEntries(Object.entries(this.modelFiles).map(([slot, file]) => [slot, file?.name ?? null])),
            note: 'Imported model files are downloaded separately beside this manifest.',
        };
        for (const [slot, file] of Object.entries(this.modelFiles)) if (file) this.downloadFile(file.name || `${slot}-model`, file);
        this.download('character-setup.json', JSON.stringify(manifest, null, 2));
    }

    private downloadFile(name: string, file: File): void {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    private download(name: string, data: string): void {
        const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        this.status.textContent = `Exported ${name}.`;
    }

    private disposeObject(object: THREE.Object3D): void {
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                for (const material of materials) {
                    for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
                    material.dispose();
                }
            }
        });
    }

    private readonly resize = (): void => {
        const width = Math.max(320, this.canvas.clientWidth);
        const height = Math.max(180, Math.min(480, window.innerHeight * 0.42));
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    };

    private readonly dragOver = (event: DragEvent): void => { event.preventDefault(); };
    private readonly dropOnCanvas = (event: DragEvent): void => {
        event.preventDefault();
        const file = event.dataTransfer?.files[0];
        if (file) void this.loadModel(file, this.tab === 'course' ? 'course' : 'character');
    };

    private animate(): void {
        if (this.disposed) return;
        requestAnimationFrame(() => this.animate());
        const delta = Math.min(this.clock.getDelta(), 0.05);
        for (const mixer of this.mixers) mixer.update(delta);
        this.renderer.render(this.scene, this.camera);
    }

    private revoke(url: string): void {
        if (url) URL.revokeObjectURL(url);
    }

    destroy(): void {
        this.disposed = true;
        this.audio.pause();
        for (const url of [...this.urls, ...this.textureUrls]) URL.revokeObjectURL(url);
        this.revoke(this.backgroundUrl);
        this.revoke(this.musicUrl);
        this.renderer.dispose();
        window.removeEventListener('resize', this.resize);
        this.root.remove();
    }
}
