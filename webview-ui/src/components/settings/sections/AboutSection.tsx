import Section from "../Section";

interface AboutSectionProps {
	version: string;
	renderSectionHeader: (tabId: string) => JSX.Element | null;
}
const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">Axolotl v{version}</h2>
					<p>
						An AI-powered QA testing assistant for VS Code. Axolotl helps you
						automate quality assurance testing on your projects with intelligent
						test generation and execution.
					</p>
				</div>
			</Section>
		</div>
	);
};

export default AboutSection;
