/* eslint-disable react-hooks/rules-of-hooks */

import {
  GetProps,
  isSSR,
  isWeb,
  mergeEvent,
  styled,
  themeable,
  useEvent,
  withStaticProperties,
} from '@tamagui/core'
import { ScopedProps, createContextScope } from '@tamagui/create-context'
import { XStack, XStackProps, YStack } from '@tamagui/stacks'
import { useControllableState } from '@tamagui/use-controllable-state'
import React, {
  ReactNode,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Animated, PanResponder, View } from 'react-native'

const SHEET_NAME = 'Sheet'
const SHEET_HANDLE_NAME = 'SheetHandle'

export type SheetProps = ScopedProps<
  {
    open?: boolean
    defaultOpen?: boolean
    onChangeOpen?: OpenChangeHandler
    position?: number
    defaultPosition?: number
    snapPoints?: number[]
    onChangePosition?: PositionChangeHandler
    children?: ReactNode
    dismissOnOverlayPress?: boolean
    animationConfig?: Animated.SpringAnimationConfig
  },
  'Sheet'
>

type PositionChangeHandler =
  | ((position: number) => void)
  | React.Dispatch<React.SetStateAction<number>>

type OpenChangeHandler = ((open: boolean) => void) | React.Dispatch<React.SetStateAction<boolean>>

type SheetContextValue = Required<
  Pick<SheetProps, 'open' | 'position' | 'snapPoints' | 'dismissOnOverlayPress'>
> & {
  hidden: boolean
  setPosition: React.Dispatch<React.SetStateAction<number>>
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
}

const [createSheetContext, createSheetScope] = createContextScope(SHEET_NAME)
const [SheetProvider, useSheetContext] = createSheetContext<SheetContextValue>(
  SHEET_NAME,
  {} as any
)

export const SheetHandleFrame = styled(XStack, {
  name: SHEET_HANDLE_NAME,
  height: 10,
  borderRadius: 100,
  backgroundColor: '$background',
  position: 'absolute',
  pointerEvents: 'auto',
  zIndex: 10,
  y: -18,
  top: 0,
  left: '35%',
  right: '35%',
  opacity: 0.5,

  hoverStyle: {
    opacity: 0.7,
  },
})

type SheetScopedProps<A> = ScopedProps<A, 'Sheet'>

export const SheetHandle = SheetHandleFrame.extractable(
  ({ __scopeSheet, ...props }: SheetScopedProps<XStackProps>) => {
    const context = useSheetContext(SHEET_HANDLE_NAME, __scopeSheet)

    if (context.open === false) {
      return null
    }

    return (
      <SheetHandleFrame
        onPress={() => {
          const nextPos = (context.position + 1) % context.snapPoints.length
          context.setPosition(nextPos)
        }}
        {...props}
      />
    )
  }
)

export const SheetOverlayFrame = styled(YStack, {
  name: 'SheetOverlay',
  // TODO this should be $background without opacity and just customized by theme
  backgroundColor: '$color',
  fullscreen: true,
  opacity: 0.2,
  zIndex: 0,

  variants: {
    closed: {
      true: {
        opacity: 0,
        pointerEvents: 'none',
      },
      false: {
        pointerEvents: 'auto',
      },
      // TODO still have as const bug
    } as const,
  },
})

export type SheetOverlayProps = GetProps<typeof SheetOverlayFrame>

export const SheetOverlay = SheetOverlayFrame.extractable(
  ({ __scopeSheet, ...props }: SheetScopedProps<SheetOverlayProps>) => {
    const context = useSheetContext(SHEET_HANDLE_NAME, __scopeSheet)
    return (
      <SheetOverlayFrame
        closed={!context.open || context.hidden}
        {...props}
        onPress={mergeEvent(
          props.onPress,
          context.dismissOnOverlayPress
            ? () => {
                context.setOpen(false)
              }
            : undefined
        )}
      />
    )
  }
)

export const SheetFrame = styled(YStack, {
  name: 'SheetFrame',
  flex: 1,
  backgroundColor: '$background',
  borderTopLeftRadius: '$4',
  borderTopRightRadius: '$4',
  padding: '$4',
  width: '100%',
  pointerEvents: 'auto',
})

const useIsSSR = () => {
  const [val, setVal] = useState(isWeb ? isSSR : false)
  useEffect(() => {
    if (isWeb && !isSSR) {
      setVal(false)
    }
  }, [])
  return val
}

// set all the way off screen
const HIDDEN_SIZE = 10_000

export const Sheet = withStaticProperties(
  themeable(
    forwardRef<View, SheetProps>((props, ref) => {
      const {
        __scopeSheet,
        snapPoints: snapPointsProp = [80, 10],
        open: openProp,
        defaultOpen,
        children: childrenProp,
        position: positionProp,
        onChangePosition,
        onChangeOpen,
        defaultPosition,
        dismissOnOverlayPress = true,
        animationConfig,
      } = props

      const isServerSide = useIsSSR()

      // we can put non-server side hooks after conditional because based on env
      if (isServerSide) {
        return null
      }

      // allows for sheets to be controlled by other components
      let controller: SheetControllerContextValue | null = null
      try {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        controller = useContext(SheetControllerContext)
      } catch {
        // uncontrolled
      }
      const isHidden = controller?.hidden || false

      const onChangeOpenInternal = (val: boolean) => {
        controller?.onChangeOpen?.(val)
        onChangeOpen?.(val)
      }

      const [open, setOpen] = useControllableState({
        prop: controller?.open ?? openProp,
        defaultProp: defaultOpen || true,
        onChange: onChangeOpenInternal,
        strategy: controller ? 'most-recent-wins' : 'prop-wins',
      })

      const [frameSize, setFrameSize] = useState<number>(0)
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const snapPoints = useMemo(() => snapPointsProp, [JSON.stringify(snapPointsProp)])

      // lets set -1 to be always the "open = false" position
      const [position_, setPosition] = useControllableState({
        prop: positionProp,
        defaultProp: defaultPosition || (open ? 0 : -1),
        onChange: onChangePosition,
      })
      const position = open === false ? -1 : position_

      const positionValue = useRef<Animated.Value>()
      if (!positionValue.current) {
        positionValue.current = new Animated.Value(HIDDEN_SIZE)
      }

      const spring = useRef<Animated.CompositeAnimation | null>(null)
      function stopSpring() {
        spring.current?.stop()
        spring.current = null
      }

      // open must set position
      if (open && position < 0) {
        setPosition(0)
      }

      const positions = useMemo(
        () => snapPoints.map((point) => getPercentSize(point, frameSize)),
        [frameSize, snapPoints]
      )

      const animateTo = useEvent((position: number) => {
        if (isHidden && open) return
        const pos = positionValue.current
        if (!pos) return
        if (frameSize === 0) return
        const hiddenValue = frameSize === 0 ? HIDDEN_SIZE : frameSize
        const toValue = isHidden || position === -1 ? hiddenValue : positions[position]
        if (pos['_value'] === toValue) return
        stopSpring()
        if (isHidden) {
          Animated.timing(pos, {
            useNativeDriver: !isWeb,
            toValue,
            duration: 0,
          }).start()
          return
        }
        // dont bounce on initial measure to bottom
        const overshootClamping = pos['_value'] === HIDDEN_SIZE
        spring.current = Animated.spring(pos, {
          useNativeDriver: !isWeb,
          toValue,
          overshootClamping,
          ...animationConfig,
        })
        spring.current.start(({ finished }) => finished && stopSpring())
      })

      useLayoutEffect(() => {
        animateTo(position)
      }, [isHidden, position, animateTo])

      const panResponder = useMemo(() => {
        if (!frameSize) return

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const pos = positionValue.current!
        const minY = positions[0]
        let startY = pos['_value']

        return PanResponder.create({
          onMoveShouldSetPanResponder: (_e, { dy }) => {
            // we could do some detection of other touchables and cancel here..
            // console.log('wut is', _e)
            return Math.abs(dy) > 6
          },
          onPanResponderGrant: () => {
            stopSpring()
            startY = pos['_value']
          },
          onPanResponderMove: (_e, { dy }) => {
            const to = dy + startY
            pos.setValue(resisted(to, minY))
          },
          onPanResponderRelease: (_e, { vy, dy }) => {
            const at = dy + startY
            // seems liky vy goes up to about 4 at the very most (+ is down, - is up)
            // lets base our multiplier on the total layout height
            const end = at + frameSize * vy * 0.33
            let closestPoint = 0
            let dist = Infinity
            for (let i = 0; i < positions.length; i++) {
              const position = positions[i]
              const curDist = end > position ? end - position : position - end
              if (curDist < dist) {
                dist = curDist
                closestPoint = i
              }
            }
            // have to call both because state may not change but need to snap back
            setPosition(closestPoint)
            animateTo(closestPoint)
          },
        })
      }, [animateTo, frameSize, positions, setPosition])

      let handleComponent: React.ReactElement | null = null
      let overlayComponent: React.ReactElement | null = null
      let frameComponent: React.ReactElement | null = null

      React.Children.forEach(childrenProp, (child) => {
        if (isValidElement(child)) {
          const name = child.type?.['staticConfig']?.componentName
          switch (name) {
            case 'SheetHandle':
              handleComponent = child
              break
            case 'SheetFrame':
              frameComponent = child
              break
            case 'SheetOverlay':
              overlayComponent = child
              break
            default:
              console.warn('Warning: passed invalid child to Sheet', child)
          }
        }
      })

      const preventShown = controller?.hidden && controller?.open

      if (preventShown) {
        return null
      }

      return (
        <SheetProvider
          dismissOnOverlayPress={dismissOnOverlayPress}
          open={open}
          hidden={isHidden}
          scope={__scopeSheet}
          position={position}
          snapPoints={snapPoints}
          setPosition={setPosition}
          setOpen={setOpen}
        >
          {overlayComponent}
          {/* no fancy hidden animation etc for handle for now */}
          {isHidden ? null : handleComponent}
          <Animated.View
            ref={ref}
            {...panResponder?.panHandlers}
            onLayout={(e) => {
              setFrameSize(e.nativeEvent.layout.height)
            }}
            pointerEvents="none"
            style={{
              position: 'absolute',
              zIndex: 10,
              width: '100%',
              height: '100%',
              transform: [{ translateY: frameSize === 0 ? HIDDEN_SIZE : positionValue.current }],
            }}
          >
            {frameComponent}
          </Animated.View>
        </SheetProvider>
      )
    }),
    {
      componentName: 'Sheet',
    }
  ),
  {
    Handle: SheetHandle,
    Frame: SheetFrame,
    Overlay: SheetOverlay,
  }
)

function getPercentSize(point?: number, frameSize?: number) {
  if (!frameSize) return 0
  if (point === undefined) {
    console.warn(`No snapPoint`)
    return 0
  }
  const pct = point / 100
  const next = frameSize - pct * frameSize
  return next
}

function resisted(y: number, minY: number, maxOverflow = 25) {
  if (y < minY) {
    const past = minY - y
    const pctPast = Math.min(maxOverflow, past) / maxOverflow
    const diminishBy = 1.1 - Math.pow(0.1, pctPast)
    const extra = -diminishBy * maxOverflow
    return minY + extra
  }
  return y
}

type SheetControllerContextValue = {
  open: boolean
  // hide without "closing" to prevent re-animation when shown again
  hidden: boolean
  onChangeOpen?: React.Dispatch<React.SetStateAction<boolean>> | ((val: boolean) => void)
}

const SheetControllerContext = createContext<SheetControllerContextValue>({
  open: false,
  hidden: false,
})

export const SheetController = ({
  children,
  onChangeOpen: onChangeOpenProp,
  ...value
}: SheetControllerContextValue & { children?: React.ReactNode }) => {
  const onChangeOpen = useEvent(onChangeOpenProp)

  const memoValue = useMemo(
    () => ({
      open: value.open,
      hidden: value.hidden || false,
      onChangeOpen,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value.open, value.hidden]
  )

  return (
    <SheetControllerContext.Provider value={memoValue}>{children}</SheetControllerContext.Provider>
  )
}

export { createSheetScope }