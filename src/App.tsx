import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Columns2,
  Github,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Share2,
  SplitSquareHorizontal,
  Upload,
  X,
} from 'lucide-react';
import {
  MAX_IMAGES,
  emptyMetadata,
  type AlignmentChoices,
  type AlignmentMode,
  type Config,
  type LocalImage,
  type Metadata,
} from '../shared/model';
import { API_URL, fetchComparison, publicImageUrl } from './lib/api';
import { ANDROID_MODE, DEMO_MODE, SHARING_UNAVAILABLE_MESSAGE } from './lib/config';
import { formatBytes, loadImage } from './lib/images';
import { Viewer, type FullscreenControl } from './components/Viewer';
import { ChoiceMenu } from './components/ChoiceMenu';
import { DesktopImageName } from './components/DesktopImageName';
import { useAnchoredPopover } from './components/useAnchoredPopover';
import { GestureDiagnostics } from './components/GestureDiagnostics';
import { InstallationHelp } from './components/InstallationHelp';
import { Modal } from './components/Modal';
import { MetadataEditor } from './components/MetadataEditor';
import { readDeletionKey, ShareDialog, type Published } from './components/ShareDialog';
import { PublicationRecoveryDialog } from './components/PublicationRecoveryDialog';
import { JOURNAL_CHANGED, pendingPublications } from './lib/publication-journal';
import {
  changeAlignment,
  choiceFor,
  imagePair,
  retainChoices,
  selectImages,
} from './lib/alignment';
import { AlignmentOptions, AlignmentDialog } from './components/ImageAlignment';
import {
  createWebSessionStore,
  requestPersistentStorage,
  webSessionError,
  type LocalSession,
} from './lib/web-session';

import type { AndroidImage, AndroidImageSource } from './lib/android';
import type { AndroidServices } from './lib/android-services';
import {
  WEB_PRESENTATION,
  presentationClasses,
  type ComparisonPresentation,
} from './lib/comparison-presentation';

const SOURCE = 'https://github.com/Kuba25x/upscale-compare';
// Keep browser coverage of the existing publication flow on disposable loopback fixtures.
const loopbackHosts = ['localhost', '127.0.0.1'];
const localSharingTest =
  !DEMO_MODE &&
  import.meta.env.VITE_LOCAL_SHARING_TEST_UI === 'true' &&
  loopbackHosts.includes(location.hostname) &&
  loopbackHosts.includes(new URL(API_URL, location.href).hostname);
const initialConfig: Config = {
  mode: 'split',
  selected: [0, 1],
  divider: 0.5,
  view: { zoom: null, center: { x: 0, y: 0 } },
};
type UploadAction = { kind: 'all' | 'add' } | { kind: 'one'; index: number };
const defaultLabel = (image: LocalImage) =>
  image.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Screenshot';

const noChoices: AlignmentChoices = [];

function AndroidThumbnail({
  id,
  load,
}: {
  id: string;
  load: AndroidServices['loadAndroidThumbnail'];
}) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let active = true;
    void load(id)
      .then((dataUrl) => {
        if (active) setSrc(dataUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, load]);
  return <img src={src} alt="" />;
}

interface AppProps {
  android?: AndroidServices;
  presentation?: ComparisonPresentation;
  onSetMinimalist?: (minimalist: boolean) => Promise<void>;
  renderFullscreenControl?: FullscreenControl;
  className?: string;
  installedAndroidFullscreen?: boolean;
  minimalistExitLabel?: string;
  displayError?: { message: string };
  desktopImageControls?: boolean;
  observePortraitImagePanel?: (panel: HTMLDivElement) => (() => void) | undefined;
}
export default function App({
  android,
  presentation = WEB_PRESENTATION,
  onSetMinimalist,
  renderFullscreenControl,
  className = '',
  installedAndroidFullscreen = false,
  minimalistExitLabel,
  displayError,
  desktopImageControls = false,
  observePortraitImagePanel,
}: AppProps = {}) {
  const [images, setImages] = useState<LocalImage[]>([]);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [config, setConfig] = useState<Config>(initialConfig);
  const [alignmentChoices, setAlignmentChoices] = useState<AlignmentChoices>(noChoices);
  const [webSession] = useState(() => (ANDROID_MODE ? undefined : createWebSessionStore()));
  const [storageError, setStorageError] = useState('');
  const requestedPersistence = useRef(false);
  const lastSaved = useRef<LocalSession | null>(null);
  const [modal, setModal] = useState<
    | 'upload'
    | 'upload-help'
    | 'upload-privacy'
    | 'metadata'
    | 'share'
    | 'help'
    | 'privacy'
    | 'recovery'
    | 'alignment'
    | null
  >(null);
  const phone = presentation.phone;
  const phonePortrait = phone === 'portrait';
  const phoneLandscape = phone === 'landscape';
  const [phonePopovers, setPhonePopovers] = useState<string[]>([]);
  const trackPhonePopover = useCallback((id: string, open: boolean) => {
    setPhonePopovers((previous) => {
      if (previous.includes(id) === open) return previous;
      return open ? [...previous, id] : previous.filter((entry) => entry !== id);
    });
  }, []);
  const onPhonePopoverChange = android ? trackPhonePopover : undefined;
  const manageHelpOpen = modal === 'upload-help' || modal === 'upload-privacy';
  const managing = modal === 'upload' || manageHelpOpen;
  const closePrivacy = () => setModal(manageHelpOpen ? 'upload-help' : null);
  const [error, setError] = useState('');
  const [androidImageSource, setAndroidImageSource] = useState<AndroidImageSource>('photos');
  const [loading, setLoading] = useState(true);
  const currentImages = useRef(images);
  currentImages.current = images;
  const savingImages = useRef(false);
  const headerControls = useRef<HTMLDivElement>(null);
  const manageTrigger = useRef<HTMLButtonElement>(null);
  const uploadList = useRef<HTMLDivElement>(null);
  const addImagesButton = useRef<HTMLButtonElement>(null);
  const phoneHelpButton = useRef<HTMLButtonElement>(null);
  const focusAfterClose = useRef(false);
  const focusAfterRemoval = useRef<number | null>(null);
  const focusAfterHelp = useRef(false);
  const closeHelp = () => {
    focusAfterHelp.current = Boolean(phoneHelpButton.current);
    setModal(manageHelpOpen ? 'upload' : null);
  };
  const previousLayout = useRef({ phone, managing });
  useLayoutEffect(() => {
    const previous = previousLayout.current;
    previousLayout.current = { phone, managing };
    // Rotation or Escape can remove the focused editor before it receives blur.
    if (previous.phone && (phone !== previous.phone || (previous.managing && !managing)))
      setImages((images) =>
        images.every((image) => image.label.trim())
          ? images
          : images.map((image) =>
              image.label.trim() ? image : { ...image, label: defaultLabel(image) },
            ),
      );
  }, [phone, managing]);
  useEffect(() => {
    if (focusAfterHelp.current && (modal === null || modal === 'upload')) {
      focusAfterHelp.current = false;
      phoneHelpButton.current?.focus({ preventScroll: true });
    }
    if (modal === null && focusAfterClose.current) {
      focusAfterClose.current = false;
      manageTrigger.current?.focus({ preventScroll: true });
    }
    if (modal === 'upload' && !loading && focusAfterRemoval.current !== null) {
      const buttons = uploadList.current?.querySelectorAll<HTMLButtonElement>('.icon-button');
      const next = buttons?.[Math.min(focusAfterRemoval.current, buttons.length - 1)];
      focusAfterRemoval.current = null;
      (next ?? addImagesButton.current)?.focus();
    }
  }, [modal, images, loading]);
  const minimalist = presentation.minimalist;
  const compactLayout = presentation.compact;
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const imagePanel = useRef<HTMLDivElement>(null);
  const imagePanelToggle = useRef<HTMLButtonElement>(null);
  const compactWeb = !ANDROID_MODE && compactLayout;
  useLayoutEffect(() => {
    if (!ANDROID_MODE) setImagePanelOpen(false);
  }, [compactLayout]);
  useLayoutEffect(() => {
    if (compactWeb && !imagePanelOpen && imagePanel.current?.contains(document.activeElement))
      imagePanelToggle.current?.focus({ preventScroll: true });
  }, [compactWeb, imagePanelOpen]);
  useEffect(() => {
    if (displayError) setError(displayError.message);
  }, [displayError]);
  const [restored, setRestored] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [published, setPublished] = useState<Published>();
  const [publishedSnapshot, setPublishedSnapshot] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [pendingCount, setPendingCount] = useState(() =>
    localSharingTest ? pendingPublications().length : 0,
  );
  useEffect(() => {
    if (!localSharingTest) return;
    const update = () => setPendingCount(pendingPublications().length);
    window.addEventListener(JOURNAL_CHANGED, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(JOURNAL_CHANGED, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  useEffect(() => {
    if (!android) return;
    const listener = android.app.addListener('appRestoredResult', (result) => {
      if (result.pluginId !== 'Originals' || result.methodName !== 'pick') return;
      if (result.success && Array.isArray(result.data?.images)) {
        void android
          .discardOriginals(result.data.images)
          .catch((reason) => setError(reason.message));
      }
      setError(
        'Import was interrupted when Android restarted the app. Please choose the files again.',
      );
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [android]);
  useEffect(() => {
    let active = true;
    const restore = android ? android.restoreAndroidSession() : webSession!.restore();
    void restore
      .then((session) => {
        if (!active || (!android && !DEMO_MODE && location.hash.startsWith('#c/'))) {
          session?.images.forEach((image) => {
            if ('file' in image) URL.revokeObjectURL(image.url);
          });
          return;
        }
        if (!session) return;
        const pair = imagePair(session.images, session.config.selected);
        const choices =
          session.alignmentChoices ?? (pair ? [{ pair, mode: 'original' as const }] : noChoices);
        lastSaved.current = { ...session, alignmentChoices: choices };
        setImages(session.images);
        setMetadata(session.metadata);
        setConfig(session.config);
        setAlignmentChoices(choices);
      })
      .catch((reason) => {
        if (active) setError(`Could not restore the local session: ${reason.message}`);
      })
      .finally(() => {
        if (active) {
          setRestored(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [android, webSession]);
  const snapshot: LocalSession = { images, metadata, config, alignmentChoices };
  const latestSession = useRef(snapshot);
  latestSession.current = snapshot;
  useEffect(() => {
    if (!restored || loading || route || readOnly || images.length < 2) return;
    const save = () => {
      const current = latestSession.current;
      if (
        savingImages.current ||
        current.images !== images ||
        current.config !== config ||
        current.metadata !== metadata ||
        current.alignmentChoices !== alignmentChoices
      )
        return;
      const saved = lastSaved.current;
      if (
        saved?.images === images &&
        saved.config === config &&
        saved.metadata === metadata &&
        saved.alignmentChoices === alignmentChoices
      )
        return;
      lastSaved.current = current;
      const persisted = android ? android.saveAndroidSession(current) : webSession!.save(current);
      return persisted
        .then((result) => {
          if (result?.warning) setError(result.warning);
          if (!android) setStorageError('');
        })
        .catch((reason) => {
          if (lastSaved.current === current) lastSaved.current = saved;
          if (android) setError(`Could not save the local session: ${reason.message}`);
          else setStorageError(webSessionError(reason));
        });
    };
    const previous = lastSaved.current;
    const immediate =
      previous?.alignmentChoices !== alignmentChoices ||
      previous?.images !== images ||
      previous?.metadata !== metadata ||
      previous?.config.selected !== config.selected ||
      previous?.config.mode !== config.mode;
    if (immediate) void save();
    const timer = immediate ? undefined : window.setTimeout(() => void save(), 250);
    const listener = android?.app.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) void save();
    });
    const onVisibility = () => {
      if (document.hidden) void save();
    };
    if (!android) document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      void listener?.then((handle) => handle.remove());
      if (!android) document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [
    android,
    webSession,
    images,
    metadata,
    config,
    alignmentChoices,
    restored,
    loading,
    route,
    readOnly,
  ]);
  useEffect(() => {
    if (restored && !loading && minimalist && images.length < 2) void onSetMinimalist?.(false);
  }, [images.length, restored, loading, minimalist, onSetMinimalist]);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAction = useRef<UploadAction>({ kind: 'all' });
  const dragDepth = useRef(0);
  const updateConfig = useCallback((update: (previous: Config) => Config) => setConfig(update), []);
  const help = useCallback(() => setModal('help'), []);
  const details = useCallback(() => setModal('metadata'), []);
  useEffect(() => {
    const hashChange = () => setRoute(location.hash);
    window.addEventListener('hashchange', hashChange);
    return () => {
      window.removeEventListener('hashchange', hashChange);
      for (const image of currentImages.current) if (image.file) URL.revokeObjectURL(image.url);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!route || !restored) return;
    setModal(null);
    if (DEMO_MODE) {
      setError(SHARING_UNAVAILABLE_MESSAGE);
      return;
    }
    const match = route.match(/^#c\/([a-f0-9]{16})$/);
    if (!match) {
      setError('This comparison link is invalid.');
      return;
    }
    setLoading(true);
    setError('');
    fetchComparison(match[1])
      .then(async (comparison) => {
        const loaded = await Promise.all(
          comparison.images.map(async (image, index) => {
            const url = publicImageUrl(comparison.id, index),
              bitmap = new Image();
            bitmap.src = url;
            await bitmap.decode();
            return { ...image, url, id: `shared-${index}` };
          }),
        );
        if (!active) return;
        currentImages.current.forEach((image) => {
          if (image.file) URL.revokeObjectURL(image.url);
        });
        setImages(loaded);
        setMetadata(comparison.metadata);
        const { alignment, ...viewConfig } = comparison.config;
        const pair = imagePair(loaded, viewConfig.selected);
        setConfig(viewConfig);
        setAlignmentChoices(pair && alignment ? [{ pair, mode: alignment }] : noChoices);
        setReadOnly(true);
        setPublished({
          id: comparison.id,
          shareUrl: `${API_URL}/s/${comparison.id}`,
          deleteToken: readDeletionKey(comparison.id),
        });
        document.title = `${comparison.metadata.game || 'Shared comparison'} — Upscale Compare`;
      })
      .catch((reason) => {
        if (active) setError(reason.message || 'The comparison images could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [route, restored]);
  const commitImages = async (
    nextImages: LocalImage[],
    nextConfig: Config,
    nextMetadata = metadata,
    nextChoices = retainChoices(alignmentChoices, nextImages),
    clear = false,
  ) => {
    const nextSession = {
      images: nextImages,
      config: nextConfig,
      metadata: nextMetadata,
      alignmentChoices: nextChoices,
    };
    savingImages.current = true;
    try {
      if (android) {
        const draft = nextImages.length === 1 ? nextImages[0] : undefined;
        const result = await android.saveAndroidSession(
          draft
            ? {
                images: [],
                config: initialConfig,
                metadata: emptyMetadata(),
                alignmentChoices: noChoices,
              }
            : nextSession,
          draft,
        );
        if (result.warning) setError(result.warning);
        setRestored(true);
      } else {
        try {
          await webSession!.save(nextSession, clear);
          setStorageError('');
        } catch (reason) {
          if (clear) throw new Error(webSessionError(reason));
          setStorageError(webSessionError(reason));
        }
      }
      lastSaved.current = nextSession;
    } finally {
      savingImages.current = false;
    }
    const keptUrls = new Set(nextImages.map((image) => image.url));
    for (const image of images) {
      if (image.file && !keptUrls.has(image.url)) URL.revokeObjectURL(image.url);
    }
    currentImages.current = nextImages;
    setImages(nextImages);
    setConfig(nextConfig);
    setMetadata(nextMetadata);
    setAlignmentChoices(nextChoices);
    setPublished(undefined);
  };
  const removeImages = async (index?: number, restoreFocus = true) => {
    if (loading) return false;
    const nextImages = index === undefined ? [] : images.filter((_, i) => i !== index);
    const nextChoices = retainChoices(alignmentChoices, nextImages);
    let nextConfig = initialConfig;
    if (nextImages.length === 1) {
      // Keep the other comparison settings while the user fills the draft.
      nextConfig = { ...config, selected: initialConfig.selected };
    } else if (nextImages.length >= 2) {
      const [a, b] = config.selected.map((i) => nextImages.indexOf(images[i]));
      // Keep any surviving selection in its slot; fill a vacant slot with the first free image.
      nextConfig = selectImages(
        config,
        nextImages,
        [a < 0 ? (b === 0 ? 1 : 0) : a, b < 0 ? (a === 0 ? 1 : 0) : b],
        nextChoices,
        true,
        false,
      );
    }
    setLoading(true);
    setError('');
    if (restoreFocus) focusAfterRemoval.current = index ?? 0;
    try {
      await commitImages(
        nextImages,
        nextConfig,
        nextImages.length ? metadata : emptyMetadata(),
        nextChoices,
        index === undefined && restoreFocus,
      );
      return true;
    } catch (reason) {
      focusAfterRemoval.current = null;
      setError(`Could not update the local comparison: ${(reason as Error).message}`);
      return false;
    } finally {
      setLoading(false);
    }
  };
  const closeManageImages = async () => {
    if (loading || (images.length === 1 && !(await removeImages(undefined, false)))) return;
    focusAfterClose.current = true;
    setModal(null);
  };
  const closeAndroidModal = useEffectEvent(() => {
    if (modal === 'upload') void closeManageImages();
    else if (modal === 'alignment') closeAlignment();
    else if (modal === 'help' || modal === 'upload-help') closeHelp();
    else if (modal === 'upload-privacy') closePrivacy();
    else setModal(null);
  });
  useEffect(() => {
    if (!android) return;
    // Intercept transient controls and fullscreen navigation; leave root predictive back to Android.
    void android.app.toggleBackButtonHandler({
      enabled:
        Boolean(modal) ||
        loading ||
        phonePopovers.length > 0 ||
        minimalist ||
        (compactLayout && imagePanelOpen),
    });
    const listener = android.app.addListener('backButton', () => {
      if (loading) return;
      if (modal) closeAndroidModal();
      else if (phonePopovers.length > 0)
        document.getElementById(phonePopovers.at(-1)!)?.hidePopover();
      else if (minimalist) void onSetMinimalist?.(false);
      else if (compactLayout && imagePanelOpen) setImagePanelOpen(false);
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [
    android,
    modal,
    loading,
    phonePopovers,
    minimalist,
    onSetMinimalist,
    compactLayout,
    imagePanelOpen,
  ]);

  const requestFiles = (action: UploadAction, source: AndroidImageSource = androidImageSource) => {
    if (android) {
      const replacingAll = action.kind === 'all' || readOnly;
      setAndroidImageSource(source);
      setLoading(true);
      setError('');
      void android
        .pickOriginals(
          replacingAll ? MAX_IMAGES : action.kind === 'one' ? 1 : MAX_IMAGES - images.length,
          replacingAll ? 2 : 1,
          source,
        )
        .then((selected) => upload(selected, action))
        .catch((reason) => setError(reason.message || 'Could not import the selected originals.'))
        .finally(() => setLoading(false));
      return;
    }
    uploadAction.current = action;
    fileInput.current!.multiple = action.kind !== 'one';
    fileInput.current!.value = '';
    fileInput.current!.click();
  };
  const upload = async (files: File[] | LocalImage[], action: UploadAction) => {
    if (!files.length) return;
    setError('');
    const replacingAll = action.kind === 'all' || readOnly;
    const maximum = replacingAll
      ? MAX_IMAGES
      : action.kind === 'one'
        ? 1
        : MAX_IMAGES - images.length;
    const minimum = replacingAll ? 2 : 1;
    if (files.length < minimum || files.length > maximum) {
      if (android) await android.discardOriginals(files as LocalImage[]);
      setError(
        replacingAll
          ? 'Select two to four images for a comparison.'
          : action.kind === 'one'
            ? 'Choose one replacement image.'
            : 'A comparison can contain up to four images.',
      );
      return;
    }

    if (webSession && !requestedPersistence.current) {
      requestedPersistence.current = true;
      void requestPersistentStorage();
    }
    setLoading(true);
    const loaded: LocalImage[] = [];
    try {
      if (android) loaded.push(...(files as LocalImage[]));
      else {
        const results = await Promise.allSettled((files as File[]).map(loadImage));
        for (const result of results) if (result.status === 'fulfilled') loaded.push(result.value);
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) throw failure.reason;
      }
      const nextImages = replacingAll
        ? loaded
        : action.kind === 'one'
          ? images.map((image, i) => (i === action.index ? loaded[0] : image))
          : [...images, ...loaded];
      const nextChoices = replacingAll ? noChoices : retainChoices(alignmentChoices, nextImages);
      const nextConfig = replacingAll
        ? selectImages(initialConfig, nextImages, initialConfig.selected, nextChoices, true)
        : images.length < 2
          ? selectImages(config, nextImages, initialConfig.selected, nextChoices, true)
          : action.kind === 'one' && config.selected.includes(action.index)
            ? selectImages(config, nextImages, config.selected, nextChoices, true)
            : config;
      await commitImages(
        nextImages,
        nextConfig,
        replacingAll ? emptyMetadata() : metadata,
        nextChoices,
      );
      if (replacingAll) {
        setReadOnly(false);
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        setRoute('');
        document.title = 'Upscale Compare — Image quality, side by side';
      }
      if (readOnly) setModal(null);
    } catch (reason) {
      if (android) await android.discardOriginals(loaded);
      else loaded.forEach((image) => URL.revokeObjectURL(image.url));
      setError((reason as Error).message);
    } finally {
      if (!android) setLoading(false);
    }
  };
  const editLabel = (index: number, label: string) => {
    setImages((previous) =>
      previous.map((image, i) => (i === index ? { ...image, label } : image)),
    );
    setPublished(undefined);
  };
  const labelEditor = (image: LocalImage, index: number, name: string, disabled = false) => (
    <input
      aria-label={name}
      value={image.label}
      maxLength={120}
      placeholder="Screenshot label"
      disabled={disabled}
      onChange={(event) => editLabel(index, event.target.value)}
      onBlur={(event) => {
        if (!event.currentTarget.value.trim()) editLabel(index, defaultLabel(image));
      }}
    />
  );
  const select = useCallback(
    (slot: 0 | 1, index: number | 'next' | 'previous') =>
      setConfig((previous) => {
        const nextIndex =
          typeof index === 'number'
            ? index
            : (previous.selected[slot] + (index === 'next' ? 1 : -1) + images.length) %
              images.length;
        if (nextIndex === previous.selected[slot]) return previous;
        const selected: [number, number] = [...previous.selected];
        if (selected[1 - slot] === nextIndex) selected[1 - slot] = selected[slot];
        selected[slot] = nextIndex;
        return selectImages(
          previous,
          images,
          selected,
          alignmentChoices,
          typeof index === 'number',
        );
      }),
    [images, alignmentChoices],
  );
  const swap = useCallback(
    () =>
      setConfig((previous) =>
        selectImages(
          previous,
          images,
          [previous.selected[1], previous.selected[0]],
          alignmentChoices,
          false,
        ),
      ),
    [images, alignmentChoices],
  );
  const ready = images.length >= 2;
  const pair = imagePair(images, config.selected);
  const [imageA, imageB] = config.selected.map((index) => images[index]);
  const choice = choiceFor(alignmentChoices, pair);
  const alignment = choice?.mode ?? 'original';
  const shouldAskAlignment = Boolean(
    pair &&
    !choice &&
    !readOnly &&
    !route &&
    imageA &&
    imageB &&
    (imageA.width !== imageB.width || imageA.height !== imageB.height),
  );
  useEffect(() => {
    if (shouldAskAlignment && !loading && !modal && !minimalist) setModal('alignment');
  }, [loading, modal, shouldAskAlignment, minimalist]);
  const setAlignment = (mode: AlignmentMode) => {
    if (!pair || choice?.mode === mode) return;
    setConfig((previous) => changeAlignment(previous, imageA, imageB, alignment, mode));
    setAlignmentChoices((previous) => [
      ...previous.filter((entry) => entry !== choiceFor(previous, pair)),
      { pair, mode },
    ]);
  };
  const closeAlignment = (mode = alignment) => {
    setAlignment(mode);
    setModal(null);
  };
  const portraitPanelEdges =
    phonePortrait && ready && !minimalist && (ANDROID_MODE || installedAndroidFullscreen);
  useLayoutEffect(() => {
    if (!portraitPanelEdges || !installedAndroidFullscreen) return;
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!theme) return;
    const previous = theme.content;
    theme.content = getComputedStyle(document.documentElement)
      .getPropertyValue('--panel-background')
      .trim();
    return () => {
      theme.content = previous;
    };
  }, [portraitPanelEdges, installedAndroidFullscreen]);
  useLayoutEffect(() => {
    if (phonePortrait && ready && !minimalist && imagePanel.current)
      return observePortraitImagePanel?.(imagePanel.current);
  }, [phonePortrait, ready, minimalist, observePortraitImagePanel]);
  const phonePanel = useAnchoredPopover(
    'below',
    onPhonePopoverChange,
    phoneLandscape && ready && !minimalist,
  );
  const imageChoices = images.map((image, value) => ({ value, label: image.label || image.name }));
  useLayoutEffect(() => {
    const row = headerControls.current;
    if (!phonePortrait || minimalist || !row) return;
    const update = () => {
      // The max-content size includes the actual labels, icons, and gaps.
      const available = row.getBoundingClientRect().width;
      row.dataset.measuring = '';
      const required = row.getBoundingClientRect().width;
      delete row.dataset.measuring;
      row.toggleAttribute('data-fit-icons', required <= available);
    };
    const observer = new ResizeObserver(update);
    update();
    observer.observe(row);
    document.fonts.addEventListener('loadingdone', update);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', update);
      row.removeAttribute('data-fit-icons');
    };
  }, [phonePortrait, minimalist, ready]);
  const manifest = {
    images: images.map((image) => ({ label: image.label, metadata: image.metadata })),
    metadata,
    config: alignment === 'original' ? config : { ...config, alignment },
  };
  const shareControl = localSharingTest && (
    <button
      onClick={() => setModal('share')}
      disabled={loading || images.some((image) => !image.label.trim())}
      title={
        images.some((image) => !image.label.trim())
          ? 'Give each image a label before sharing.'
          : 'Create or copy a public comparison link'
      }
    >
      <Share2 size={16} />
      <span>Share Comparison</span>
    </button>
  );
  const publishedNotice = readOnly && (
    <div className="published-notice">
      <Check size={12} />
      {published?.deleted
        ? 'Deleted comparison · local preview'
        : 'Published comparison · read-only'}
      <span>Your zoom and image selection are local to this view.</span>
    </div>
  );
  return (
    <div
      className={`app ${ready ? 'has-images' : ''}${ANDROID_MODE ? ' android-app' : ' web-app'} ${presentationClasses(presentation)}${className ? ` ${className}` : ''}${portraitPanelEdges ? ' portrait-panel-edges' : ''}`}
      onKeyDown={(event) => {
        if (
          compactWeb &&
          !phone &&
          imagePanelOpen &&
          !modal &&
          event.key === 'Escape' &&
          !document.querySelector('dialog[open]')
        ) {
          event.preventDefault();
          setImagePanelOpen(false);
          imagePanelToggle.current?.focus({ preventScroll: true });
        }
      }}
      onDragEnter={(event) => {
        if (ANDROID_MODE || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (ANDROID_MODE) return;
        dragDepth.current = 0;
        setDragging(false);
        if (!loading)
          void upload([...event.dataTransfer.files], {
            kind: (ready || managing) && !readOnly ? 'add' : 'all',
          });
      }}
    >
      <input
        className="sr-only"
        type="file"
        disabled={ANDROID_MODE}
        tabIndex={-1}
        accept="image/png,image/jpeg,image/webp"
        multiple
        ref={fileInput}
        data-testid="file-input"
        aria-label="Choose comparison images"
        onChange={(event) =>
          void upload([...(event.currentTarget.files || [])], uploadAction.current)
        }
      />
      <header className="app-header">
        <h1>
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-name">Upscale Compare</span>
        </h1>
        {ready && (
          <div className="header-controls" ref={headerControls}>
            <div className="mode-controls">
              {!phonePortrait && <span className="eyebrow">MODE</span>}
              <div className="segmented" role="group" aria-label="Comparison mode">
                <button
                  aria-label="Split Screen"
                  aria-pressed={config.mode === 'split'}
                  className={config.mode === 'split' ? 'active' : ''}
                  onClick={() => setConfig((previous) => ({ ...previous, mode: 'split' }))}
                >
                  <SplitSquareHorizontal size={16} aria-hidden="true" />
                  <span>Split Screen</span>
                </button>
                <button
                  aria-label="Side-by-Side"
                  aria-pressed={config.mode === 'side'}
                  className={config.mode === 'side' ? 'active' : ''}
                  onClick={() => setConfig((previous) => ({ ...previous, mode: 'side' }))}
                >
                  <Columns2 size={16} aria-hidden="true" />
                  <span>Side-by-Side</span>
                </button>
              </div>
            </div>
            <div className="header-actions">
              {(phoneLandscape || (!phone && presentation.edgeToEdge)) && (
                <button
                  {...(phoneLandscape
                    ? {
                        ...phonePanel.triggerProps,
                        onClick: (event: React.MouseEvent) => {
                          if (event.detail === 0 && !phonePanel.isOpen())
                            phonePanel.focusWhenOpen((popup) =>
                              popup.querySelector('button')?.focus(),
                            );
                        },
                      }
                    : {
                        ref: imagePanelToggle,
                        'aria-expanded': compactLayout && imagePanelOpen,
                        'aria-controls': 'image-controls',
                        onClick: () => setImagePanelOpen((open) => !open),
                      })}
                  className="images-toggle"
                  aria-label="Image controls"
                >
                  <ChevronDown size={17} />
                  <span>Images</span>
                </button>
              )}
              {!compactWeb && shareControl}
              <button
                ref={manageTrigger}
                className="primary"
                aria-label="Manage Images"
                onClick={() => setModal('upload')}
                disabled={loading}
              >
                <ImagePlus size={17} aria-hidden="true" />
                <span>Manage Images</span>
              </button>
            </div>
          </div>
        )}
      </header>
      {ready ? (
        <main className="comparison-layout">
          <Viewer
            presentation={presentation}
            fullscreenOverride={onSetMinimalist ? minimalist : undefined}
            onToggleFullscreen={onSetMinimalist ? () => onSetMinimalist(!minimalist) : undefined}
            renderFullscreenControl={renderFullscreenControl}
            minimalistExitLabel={minimalistExitLabel}
            onImageError={
              ANDROID_MODE
                ? () =>
                    setError(
                      'The original could not be displayed. The file may be damaged or WebView may have run out of image memory. Original bytes have not been changed.',
                    )
                : undefined
            }
            images={images}
            config={config}
            alignment={alignment}
            onChange={updateConfig}
            onSwap={swap}
            onCycleImage={(direction) => select(0, direction)}
            onMetadata={details}
            onHelp={help}
            onPhonePopoverChange={onPhonePopoverChange}
          />
          {(!phone || !minimalist) && (
            <div
              key={phone ?? 'default'}
              {...(phoneLandscape
                ? { ...phonePanel.popupProps, role: 'group', 'aria-label': 'Image controls' }
                : { id: 'image-controls', ref: imagePanel })}
              className={`image-selection-bar${
                phoneLandscape
                  ? ' anchored-popover phone-images-popover'
                  : phonePortrait
                    ? ' phone-image-controls'
                    : imagePanelOpen
                      ? ' image-panel-open'
                      : ''
              }${desktopImageControls ? ' desktop-image-controls' : ''}`}
            >
              {([0, 1] as const).map((slot) => {
                const index = config.selected[slot],
                  image = images[index];
                const letter = slot === 0 ? 'A' : 'B';
                if (phone) {
                  return (
                    <div className={`phone-image-slot selector-${slot}`} key={slot}>
                      <ChoiceMenu
                        label={`Select image ${letter}`}
                        menuLabel={`Image ${letter} screenshots`}
                        value={
                          <>
                            <span className="phone-image-label">{image.label || image.name}</span>
                            <span className="file-info">
                              {image.width} × {image.height}
                            </span>
                          </>
                        }
                        badge={
                          <span className={`slot-letter slot-${slot}`} aria-hidden="true">
                            {letter}
                          </span>
                        }
                        choices={imageChoices}
                        selected={index}
                        triggerClass="phone-image-trigger"
                        menuClass="phone-image-choices"
                        onSelect={(index) => select(slot, index)}
                        onOpenChange={onPhonePopoverChange}
                      />
                    </div>
                  );
                }
                return (
                  <div className={`image-selector selector-${slot}`} key={slot}>
                    <span className={`slot-letter slot-${slot}`}>{slot === 0 ? 'A' : 'B'}</span>
                    <div className="image-selector-fields">
                      {desktopImageControls ? (
                        <DesktopImageName
                          slot={letter}
                          imageUrl={image.url}
                          label={image.label || image.name}
                          choices={imageChoices}
                          selected={index}
                          onSelect={(value) => select(slot, value)}
                          onRename={
                            readOnly
                              ? undefined
                              : (draft) => {
                                  const label = draft.trim() ? draft : defaultLabel(image);
                                  if (label !== image.label) editLabel(index, label);
                                }
                          }
                        />
                      ) : (
                        <label className="select-image">
                          <span className="sr-only">Image {letter}</span>
                          <select
                            aria-label={`Select image ${letter}`}
                            value={index}
                            onChange={(event) => select(slot, Number(event.target.value))}
                          >
                            {images.map((item, i) => (
                              <option value={i} key={i}>
                                {item.label || item.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={13} />
                        </label>
                      )}
                      <span className="file-info">
                        {image.width} × {image.height}
                        <span>
                          {' '}
                          · {formatBytes(image.size)} · {image.type.split('/')[1].toUpperCase()}
                        </span>
                      </span>
                    </div>
                    {!desktopImageControls && !readOnly && (
                      <label className="rename-label" title="Customize screenshot label">
                        <Pencil size={13} />
                        {labelEditor(image, index, `Label for image ${slot === 0 ? 'A' : 'B'}`)}
                      </label>
                    )}
                  </div>
                );
              })}
              <button
                className="swap-button icon-button"
                aria-label="Swap images"
                title="Swap A and B (X)"
                onClick={swap}
              >
                <ArrowLeftRight size={16} />
                {phoneLandscape && <span>Swap images</span>}
              </button>
              {compactWeb && (localSharingTest || publishedNotice) && (
                <div className="image-panel-publication">
                  {shareControl}
                  {publishedNotice}
                </div>
              )}
            </div>
          )}
          {!compactWeb && publishedNotice}
        </main>
      ) : !managing ? (
        <main className="landing">
          <div className="upload-center">
            <button
              ref={manageTrigger}
              className="primary upload-hero"
              onClick={() => requestFiles({ kind: 'all' }, 'photos')}
              disabled={loading}
            >
              <Upload size={23} strokeWidth={1.6} />
              Upload Images
            </button>
            <p>
              {ANDROID_MODE ? (
                <>
                  Choose 2–4 screenshots to compare
                  <br />
                  <button
                    className="text-button"
                    disabled={loading}
                    onClick={() => requestFiles({ kind: 'all' }, 'files')}
                  >
                    Browse files instead
                  </button>
                </>
              ) : (
                'Drop 2–4 screenshots here to compare'
              )}
            </p>
            <span className="landing-hint">
              PNG recommended · Original quality ·{' '}
              {ANDROID_MODE ? 'Images stay on this device' : 'Images stay in this browser'}
            </span>
          </div>
          <footer className="landing-footer">
            <button className="text-button" onClick={() => setModal('privacy')}>
              {ANDROID_MODE
                ? 'Your images stay on this device.'
                : 'Your images stay in this browser.'}
            </button>
            {phone && (
              <button ref={phoneHelpButton} className="text-button phone-help" onClick={help}>
                Help &amp; About
              </button>
            )}
            <a href={SOURCE} target="_blank" rel="noreferrer">
              <Github size={14} />
              Open source · AGPL-3.0
            </a>
          </footer>
        </main>
      ) : null}
      {localSharingTest && pendingCount > 0 && (
        <aside className="recovery-notice">
          <button onClick={() => setModal('recovery')}>Recover publication ({pendingCount})</button>
        </aside>
      )}
      {modal === 'recovery' && localSharingTest && (
        <PublicationRecoveryDialog onClose={() => setModal(null)} />
      )}
      {loading && !managing && (
        <div className="loading-indicator" role="status">
          <LoaderCircle size={17} className="spinner" />
          {route ? 'Opening comparison…' : 'Loading original images…'}
        </div>
      )}
      {error && !managing && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {storageError && !managing && !error && (
        <div className="toast" role="alert">
          <span>{storageError}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setStorageError('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={35} />
          <h2>Drop your screenshots</h2>
          <p>
            {(ready || managing) && !readOnly
              ? 'Add images to this comparison · Up to 4 total'
              : '2–4 images · PNG, JPEG, or WebP'}
          </p>
        </div>
      )}
      {managing && (
        <Modal
          title={readOnly ? 'Start your own comparison' : 'Your images'}
          onClose={() => void closeManageImages()}
          busy={loading}
        >
          <div className="manage-intro">
            <p className="muted">
              {readOnly
                ? 'Choose two to four screenshots to start a new local comparison.'
                : ANDROID_MODE
                  ? 'Originals are stored privately on this device.'
                  : 'Files stay in your browser.'}
            </p>
            {phone && (
              <button
                ref={phoneHelpButton}
                className="text-button phone-help"
                onClick={() => setModal('upload-help')}
                disabled={loading}
              >
                Help &amp; About
              </button>
            )}
          </div>
          {pair && <AlignmentOptions mode={alignment} onSelect={setAlignment} disabled={loading} />}
          {ANDROID_MODE && (
            <label>
              Image source
              <select
                aria-label="Image source"
                value={androidImageSource}
                disabled={loading}
                onChange={(event) =>
                  setAndroidImageSource(event.target.value as AndroidImageSource)
                }
              >
                <option value="photos">Photos — system Photo Picker</option>
                <option value="files">Files — document picker</option>
              </select>
            </label>
          )}
          {!readOnly && (
            <div className="upload-list" ref={uploadList}>
              {images.length === 0 && <p className="muted">No images in this comparison.</p>}
              {images.map((image, index) => (
                <div className="upload-list-item" key={image.url}>
                  {android ? (
                    <AndroidThumbnail
                      id={(image as AndroidImage).id}
                      load={android.loadAndroidThumbnail}
                    />
                  ) : (
                    <img src={image.url} alt="" />
                  )}
                  <div>
                    {phone ? (
                      labelEditor(image, index, `Label for ${image.name}`, loading)
                    ) : (
                      <b>{image.label}</b>
                    )}
                    <span className="muted">
                      {image.width} × {image.height} · {formatBytes(image.size)}
                    </span>
                  </div>
                  <button disabled={loading} onClick={() => requestFiles({ kind: 'one', index })}>
                    Replace
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Remove image ${image.name}`}
                    disabled={loading}
                    onClick={() => void removeImages(index)}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="muted small">
            {ANDROID_MODE
              ? 'PNG, JPEG, WebP · Provisional 256 MiB per image · 36 MP · 1 GiB per session'
              : 'PNG, JPEG, WebP · 20 MB per image · 36 MP per image'}
          </p>
          {loading && (
            <p className="muted" role="status">
              Updating images…
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {storageError && !error && (
            <p className="error" role="alert">
              {storageError}
            </p>
          )}
          <div className="modal-actions">
            {!readOnly && (
              <button disabled={loading || images.length === 0} onClick={() => void removeImages()}>
                Clear comparison
              </button>
            )}
            <button
              className={readOnly ? 'primary' : undefined}
              disabled={loading}
              onClick={() => requestFiles({ kind: 'all' })}
            >
              {readOnly ? 'Upload Images' : 'Replace all images'}
            </button>
            {!readOnly && (
              <button
                ref={addImagesButton}
                className="primary"
                disabled={loading || images.length === MAX_IMAGES}
                onClick={() => requestFiles({ kind: 'add' })}
              >
                <ImagePlus size={16} />
                Add images
              </button>
            )}
          </div>
        </Modal>
      )}
      {modal === 'alignment' && pair && (
        <AlignmentDialog
          key={pair.join(':')}
          a={imageA}
          b={imageB}
          mode={alignment}
          onApply={closeAlignment}
          onClose={() => closeAlignment()}
        />
      )}
      {modal === 'metadata' && (
        <MetadataEditor
          images={images}
          metadata={metadata}
          readOnly={readOnly}
          onClose={() => setModal(null)}
          onSave={(nextMetadata, nextImages) => {
            setMetadata(nextMetadata);
            setImages(nextImages);
            setPublished(undefined);
            setModal(null);
          }}
        />
      )}
      {modal === 'share' && localSharingTest && (
        <ShareDialog
          images={images}
          manifest={manifest}
          existing={
            readOnly || publishedSnapshot === JSON.stringify(manifest) ? published : undefined
          }
          readOnly={readOnly}
          onDeleted={() =>
            setPublished((previous) => (previous ? { ...previous, deleted: true } : previous))
          }
          onPublished={(value) => {
            setPublished(value);
            setPublishedSnapshot(JSON.stringify(manifest));
          }}
          onClose={() => setModal(null)}
        />
      )}
      {(modal === 'help' || modal === 'upload-help') && (
        <Modal title="A closer look at every pixel" onClose={closeHelp}>
          <p className="muted">
            Drag the image to pan. Scroll to zoom at the cursor. On touchscreens, drag with one
            finger and pinch with two.
          </p>
          <dl className="shortcuts">
            <dt>0</dt>
            <dd>Fit the complete images</dd>
            <dt>1 / 2 / 4</dt>
            <dd>100% / 200% / 400% source-pixel zoom</dd>
            <dt>+ / −</dt>
            <dd>Zoom in / out</dd>
            <dt>Arrow keys</dt>
            <dd>Pan the images</dd>
            <dt>S / V</dt>
            <dd>Split Screen / Side-by-Side</dd>
            <dt>X</dt>
            <dd>Swap image A and B</dd>
            <dt>[ / ]</dt>
            <dd>Previous / next image for A</dd>
            <dt>F</dt>
            <dd>Toggle fullscreen</dd>
            <dt>?</dt>
            <dd>Show this guide</dd>
          </dl>
          <p className="muted small">
            At 100%, one source pixel of image A maps to one physical display pixel. In Original
            Size this also applies to B. Match Width and Match Height scale B proportionally and
            keep the same top-left origin. Fit adapts to your window. Browser color management may
            affect displayed colors; HDR inspection is not supported.
          </p>
          {__WEB_PWA__ && <InstallationHelp />}
          {phone && !__WEB_PWA__ && <p className="muted small">Build {__APP_RELEASE__}</p>}
          <p className="muted small">
            <a
              href={`${import.meta.env.BASE_URL}third-party-licenses.txt`}
              target="_blank"
              rel="noreferrer"
            >
              Third-party licenses ↗
            </a>
          </p>
          <div className="modal-actions">
            <a className="text-link" href={SOURCE} target="_blank" rel="noreferrer">
              Source code · AGPL-3.0 ↗
            </a>
            <button onClick={() => setModal(manageHelpOpen ? 'upload-privacy' : 'privacy')}>
              Privacy
            </button>
            <button className="primary" onClick={closeHelp}>
              Got it
            </button>
          </div>
        </Modal>
      )}
      <GestureDiagnostics />
      {(modal === 'privacy' || modal === 'upload-privacy') && (
        <Modal title="Your images, your choice" onClose={closePrivacy}>
          <div className="privacy-copy">
            <h3>Compare privately</h3>
            <p>
              {ANDROID_MODE
                ? 'Original images are copied without recompression into private device storage. The current comparison is restored after restarting. Clear comparison removes its stored originals. App data is excluded from Android backup.'
                : 'Original images, labels, and comparison details are saved in this browser to reopen the last comparison. They are never uploaded automatically. Use Clear comparison to remove the saved files and session. Your browser may clear this storage.'}
            </p>
            {ANDROID_MODE ? (
              <p>Files available only in cloud storage cannot be imported offline.</p>
            ) : localSharingTest ? (
              <>
                <h3>Share publicly</h3>
                <p>
                  Publishing sends the unmodified files and comparison metadata to the configured
                  sharing service. Anyone with the link can view or download them. Files may include
                  embedded EXIF or other metadata.
                </p>
                <h3>Stay in control</h3>
                <p>
                  A private key is saved in this browser before uploading. Recover publication can
                  check an interrupted attempt for 24 hours, even after refresh. Download a backup
                  and keep it private: clearing browser data removes saved keys. Deleted links stop
                  working, but copies already saved by other people cannot be removed.
                </p>
                <h3>Service protection</h3>
                <p>
                  The sharing service temporarily stores hashed network identifiers to enforce rate
                  limits. Production publishing uses Cloudflare Turnstile. Hosting providers may
                  process connection logs under their own policies.
                </p>
                <p>
                  For abuse reports, contact the operator of your sharing service with the
                  comparison URL. This open-source project does not operate a hosted upload service.
                </p>
              </>
            ) : null}
          </div>
          <div className="modal-actions">
            <a
              className="text-link"
              href={`${SOURCE}/blob/main/docs/PRIVACY.md`}
              target="_blank"
              rel="noreferrer"
            >
              Privacy documentation ↗
            </a>
            <button className="primary" onClick={closePrivacy}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
