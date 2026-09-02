# implemented 语义 × 后端映射（自动生成——SSOT = SEMANTIC_BACKEND_MAP + catalog status）

> ★由 `npm run gen:docs` 生成，勿手改。覆盖门禁：每语义 ≥3 端映射（G-31.4）。
> implemented 语义 **44** 个。

| 语义 | vue-dom | native-ios | native-android | native-harmony | skyline | flutter | headless |
|------|---------|-----------|----------------|----------------|---------|---------|----------|
| `layout.box` | div.proteus-box | UIView | FrameLayout | Stack | view | Container | box |
| `layout.inline` | div.proteus-inline | UITextAttachment | TextView.inline | Span | view.inline | InlineSpan | inline |
| `layout.stack` | div.proteus-stack | UIStackView | LinearLayout | Flex | view.flex | Flex | stack |
| `layout.grid` | div.proteus-grid | UICollectionView | GridLayoutManager | Grid | grid | GridView | grid |
| `layout.fluid` | div.proteus-fluid | AutoLayout | ConstraintLayout | Flex.fluid | view.fluid | Wrap | fluid |
| `layout.adaptive` | div.proteus-adaptive | UISheet | BottomSheetDialog | Sheet | half-screen | showModal | adaptive |
| `layout.fit` | div.proteus-fit | intrinsicSize | wrapContent | fitContent | view.fit | IntrinsicWidth | fit |
| `layout.spacer` | div.proteus-spacer | UILayoutGuide | Space | Blank | view.spacer | Spacer | spacer |
| `layout.divider` | hr.proteus-divider | UIView.divider | View.divider | Divider | view.divider | Divider | divider |
| `layout.scroll` | div.proteus-scroll | UIScrollView | ScrollView | Scroll | scroll-view | ScrollView | scroll |
| `layout.virtual-list` | div.proteus-virtual-list | UICollectionView | RecyclerView | List | list-view | ListView | virtual-list |
| `layout.masonry` | div.proteus-masonry | UICollectionView.masonry | StaggeredGridLayoutManager | WaterFlow | grid.masonry | SliverMasonryGrid | masonry |
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
| `shell.page` | div.proteus-page | UIViewController | Activity | Page | page | Scaffold | page |
| `shell.nav` | nav.proteus-nav | UINavigationBar | Toolbar | NavigationBar | navigator | AppBar | nav |
| `shell.tabbar` | nav.proteus-tabbar | UITabBar | BottomNavigationView | Tabs | tabbar | BottomNavigationBar | tabbar |
| `shell.segment` | div.proteus-segment | UISegmentedControl | TabLayout | Segmented | segment | SegmentedButton | segment |
| `shell.drawer` | aside.proteus-drawer | UIView.drawer | DrawerLayout | Panel | view.drawer | Drawer | drawer |
| `shell.modal` | div.proteus-modal | UIAlertController | Dialog | CustomDialog | modal | showDialog | modal |
| `shell.popover` | div.proteus-popover | UIPopoverController | PopupWindow | Popup | view.popover | showMenu | popover |
| `shell.action-sheet` | div.proteus-action-sheet | UIAlertController.actionSheet | BottomSheet | ActionSheet | action-sheet | showModalBottomSheet | action-sheet |
| `layout.split` | div.proteus-split | UISplitViewController | SlidingPaneLayout | SideBarContainer | view.split | Row | split |
| `gesture.draggable` | div.proteus-draggable | UIPanGestureRecognizer | GestureDetector | PanGesture | movable-view | Draggable | draggable |
| `gesture.scrollable` | div.proteus-scrollable | UIScrollView.gesture | NestedScrollView | Scroll.gesture | scroll-view | Scrollable | scrollable |
| `capability.location` | button.proteus-location | CLLocationManager | FusedLocation | geoLocationManager | wx.getLocation | getLocation | location |
| `engineering.transition` | div.proteus-transition | UIView.transition | View.animate.transition | animateTo.transition | view.transition | AnimatedOpacity | transition |
| `engineering.animate` | div.proteus-animate | CAKeyframeAnimation | ValueAnimator | Animator.transition | view.animation | AnimationController | animate |
