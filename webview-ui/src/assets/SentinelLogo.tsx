import { SVGProps } from "react"
import type { Environment } from "../../../src/config"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * SentinelLogo component renders the Sentinel eye logo with automatic theme adaptation
 * and environment-based color indicators.
 */
const SentinelLogo = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props

	// Determine stroke color based on environment
	const strokeColor = environment ? getEnvironmentColor(environment) : "#6B4C9A"
	const fillColor = environment ? getEnvironmentColor(environment) : "#6B4C9A"

	return (
		<svg viewBox="0 0 96 96" width="50" height="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			{/* Triangle */}
			<path
				d="M48 8 L88 80 L8 80 Z"
				fill="none"
				stroke={strokeColor}
				strokeWidth="5"
				strokeLinejoin="round"
			/>
			{/* Circle */}
			<circle cx="48" cy="52" r="24" fill="none" stroke={strokeColor} strokeWidth="5" />
			{/* Eye */}
			<ellipse cx="48" cy="52" rx="12" ry="8" fill="none" stroke={strokeColor} strokeWidth="4" />
			<circle cx="48" cy="52" r="4" fill={fillColor} />
		</svg>
	)
}
export default SentinelLogo
