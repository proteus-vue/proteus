# implemented 语义 × 后端映射（自动生成——SSOT = SEMANTIC_BACKEND_MAP + catalog status）

> ★由 `npm run gen:docs` 生成，勿手改。覆盖门禁：每语义 ≥3 端映射（G-31.4）。
> implemented 语义 **65** 个。

| 语义 | vue-dom | native-ios | native-android | native-harmony | skyline | flutter | headless |
|------|---------|-----------|----------------|----------------|---------|---------|----------|
| `layout.box` | div.proteus-box | UIView | FrameLayout | Stack | view | Container | box |
| `layout.inline` | div.proteus-inline | UITextAttachment | TextView.inline | Span | view.inline | InlineSpan | inline |
| `layout.stack` | div.proteus-stack | UIStackView | LinearLayout | Flex | view.flex | Flex | stack |
| `layout.grid` | div.proteus-grid | UICollectionView | GridLayoutManager | Grid | grid | GridView | grid |
| `layout.fluid` | div.proteus-fluid | UIView.fluid | ConstraintLayout | Flex.fluid | view.fluid | Wrap | fluid |
| `layout.adaptive` | div.proteus-adaptive | UISheet | BottomSheetDialog | Sheet | half-screen | showModal | adaptive |
| `layout.fit` | div.proteus-fit | UIView.fit | wrapContent | fitContent | view.fit | IntrinsicWidth | fit |
| `layout.spacer` | div.proteus-spacer | UILayoutGuide | Space | Blank | view.spacer | Spacer | spacer |
| `layout.divider` | hr.proteus-divider | UIView.divider | View.divider | Divider | view.divider | Divider | divider |
| `layout.scroll` | div.proteus-scroll | UIScrollView | ScrollView | Scroll | scroll-view | ScrollView | scroll |
| `layout.virtual-list` | div.proteus-virtual-list | UICollectionView | RecyclerView | List | list-view | ListView | virtual-list |
| `layout.masonry` | div.proteus-masonry | UICollectionView.masonry | StaggeredGridLayoutManager | WaterFlow | grid.masonry | SliverMasonryGrid | masonry |
| `layout.formfactor` | div.proteus-formfactor | UIViewController.formFactor | FormFactorLayout | GridRow.formFactor | view.formfactor | LayoutBuilder.formFactor | formfactor |
| `layout.safe` | div.proteus-safe | safeAreaLayoutGuide | WindowInsets | getAvoidArea | env.safe-area | SafeArea | safe |
| `layout.sidebar` | div.proteus-sidebar | UISplitViewController.side | NavigationRail | SideBarContainer | view.sidebar | NavigationRail | sidebar |
| `ui.text` | span | UILabel | TextView | Text | text | Text | text |
| `ui.heading` | div.proteus-heading | UILabel.heading | TextView.heading | Text.heading | text.heading | Text.heading | heading |
| `ui.rich-text` | div.proteus-rich-text | UITextView.attributed | TextView.html | RichText | rich-text | RichText | rich-text |
| `ui.icon` | span.proteus-icon | UIImageView.icon | ImageView.icon | SymbolGlyph | icon | Icon | icon |
| `ui.image` | img | UIImageView | ImageView | Image | image | Image | image |
| `ui.avatar` | div.proteus-avatar | UIImageView.avatar | ImageView.avatar | Image.avatar | image.avatar | CircleAvatar | avatar |
| `ui.media` | div.proteus-media | AVPlayerView | VideoView | Video | video | VideoPlayer | media |
| `ui.canvas` | canvas | UIView.canvas | SurfaceView | Canvas | canvas | CustomPaint | canvas |
| `ui.svg` | svg | UIView.svg | VectorDrawable | Shape | view.svg | SvgPicture | svg |
| `ui.input` | input | UITextField | EditText | TextInput | input | TextField | input |
| `ui.textarea` | textarea | UITextView | EditText.multiline | TextArea | textarea | TextField.multiline | textarea |
| `ui.select` | div.proteus-select | UIPickerView | Spinner | Select | picker | DropdownButton | select |
| `ui.checkbox` | div.proteus-checkbox | UIButton.checkbox | CheckBox | Checkbox | checkbox | Checkbox | checkbox |
| `ui.radio` | div.proteus-radio | UIButton.radio | RadioButton | Radio | radio | Radio | radio |
| `ui.switch` | div.proteus-switch | UISwitch | Switch | Toggle | switch | Switch | switch |
| `ui.slider` | div.proteus-slider | UISlider | SeekBar | Slider | slider | Slider | slider |
| `ui.picker` | div.proteus-picker | UIDatePicker | DatePicker | DatePicker | picker-view | showDatePicker | picker |
| `ui.form` | form | UIView.form | LinearLayout.form | FormComponent | form | Form | form |
| `ui.progress` | div.proteus-progress | UIProgressView | ProgressBar | Progress | progress | LinearProgressIndicator | progress |
| `ui.label` | label | UILabel.label | TextView.label | Text.label | label | Text.label | label |
| `ui.selection` | div.proteus-selection | UITextView.selection | TextView.selection | Text.selection | selection | SelectableText | selection |
| `ui.camera` | video.proteus-camera | AVCaptureVideoPreviewLayer | CameraX.PreviewView | XComponent.camera | camera | CameraPreview | camera |
| `ui.map` | div.proteus-map | MKMapView | MapView | MapComponent | map | GoogleMap | map |
| `ui.button` | button | UIButton | Button | Button | button | FilledButton | button |
| `ui.list` | div.proteus-list | UITableView | RecyclerView | List | list-view | ListView | list |
| `ui.nav` | nav | UINavigationController | NavigationRail | Navigation | navigator | Navigator | nav |
| `shell.page` | div.proteus-page | UIViewController | Activity | Page | page | Scaffold | page |
| `shell.nav` | nav.proteus-nav | UINavigationBar | Toolbar | NavigationBar | navigator | AppBar | nav |
| `shell.tabbar` | nav.proteus-tabbar | UITabBar | BottomNavigationView | Tabs | tabbar | BottomNavigationBar | tabbar |
| `shell.segment` | div.proteus-segment | UISegmentedControl | TabLayout | Segmented | segment | SegmentedButton | segment |
| `shell.drawer` | aside.proteus-drawer | UIView.drawer | DrawerLayout | Panel | view.drawer | Drawer | drawer |
| `shell.modal` | div.proteus-modal | UIAlertController | Dialog | CustomDialog | modal | showDialog | modal |
| `shell.popover` | div.proteus-popover | UIPopoverController | PopupWindow | Popup | view.popover | showMenu | popover |
| `shell.action-sheet` | div.proteus-action-sheet | UIAlertController.actionSheet | BottomSheet | ActionSheet | action-sheet | showModalBottomSheet | action-sheet |
| `layout.split` | div.proteus-split | UISplitViewController | SlidingPaneLayout | SideBarContainer | view.split | Row | split |
| `shell.page-container` | div.proteus-page-container | UIPresentationController | BottomSheetDialog | bindSheet | page-container | showModalBottomSheet | page-container |
| `shell.keyboard-accessory` | div.proteus-keyboard-accessory | UIInputView | InputMethodService.accessory | KeyboardAccessory | keyboard-accessory | KeyboardAccessoryView | keyboard-accessory |
| `shell.webview` | div.proteus-webview | WKWebView | WebView | Web | web-view | WebView | webview |
| `shell.ad` | div.proteus-ad | UIView.ad | View.ad | AdSlot | ad | AdWidget | ad |
| `gesture.tap` | v-gesture:tap（Pointer 识别器） | UITapGestureRecognizer | GestureDetector.onSingleTapUp | TapGesture | bindtap | GestureDetector.onTap | tap |
| `gesture.longpress` | v-gesture:longpress（Pointer 识别器） | UILongPressGestureRecognizer | GestureDetector.onLongPress | LongPressGesture | bindlongpress | GestureDetector.onLongPress | longpress |
| `gesture.draggable` | div.proteus-draggable | UIPanGestureRecognizer | GestureDetector | PanGesture | movable-view | Draggable | draggable |
| `gesture.scrollable` | div.proteus-scrollable | UIScrollView.gesture | NestedScrollView | Scroll.gesture | scroll-view | Scrollable | scrollable |
| `capability.camera` | input.proteus-pick-photo | UIImagePicker | PhotoPicker | PhotoViewPicker | wx.chooseMedia | pickPhoto | pick-photo |
| `capability.location` | button.proteus-location | CLLocationManager | FusedLocation | geoLocationManager | wx.getLocation | getLocation | location |
| `capability.qr-code` | button.proteus-scan-qr | AVCaptureSession | CameraX | ScanKit | wx.scanCode | scanQR | scan-qr |
| `engineering.router-link` | a.proteus-router-link | UIButton.link | TextView.link | Text.link | navigator | TextButton | router-link |
| `engineering.transition` | div.proteus-transition | UIView.transition | View.animate.transition | animateTo.transition | view.transition | AnimatedOpacity | transition |
| `engineering.animate` | div.proteus-animate | CAKeyframeAnimation | ValueAnimator | Animator.transition | view.animation | AnimationController | animate |
| `engineering.share-element` | div.proteus-share-element | UIView.matchedTransition | SharedElementTransition | geometryTransition | share-element | Hero | share-element |
