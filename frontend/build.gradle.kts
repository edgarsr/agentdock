dependencies {
    intellijPlatform {
        bundledModule("intellij.platform.frontend")
        bundledModule("intellij.libraries.jcef")
    }
    implementation(project(":shared"))
    compileOnly("org.jetbrains.kotlinx:kotlinx-serialization-json-jvm:1.7.3")
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
}

kotlin {
    jvmToolchain(21)
    compilerOptions.freeCompilerArgs.add("-Xjvm-default=all")
    sourceSets["main"].kotlin.apply {
        srcDir(rootProject.layout.projectDirectory.dir("src/main/kotlin"))
        // The client half: JCEF, AWT, the microphone, sounds and the status bar. It must not
        // reference backend classes - in Split Mode they are not loaded in this process.
        include("agentdock/AddCodeReferenceToChatAction.kt")
        include("agentdock/AddFileReferenceToChatAction.kt")
        include("agentdock/AgentDockToolWindowFactory.kt")
        include("agentdock/AssetLoader.kt")
        include("agentdock/ExternalCodeReferenceDispatcher.kt")
        include("agentdock/IdeTheme.kt")
        include("agentdock/JcefDragAndDropSupport.kt")
        include("agentdock/acp/AcpAudioPlayer.kt")
        include("agentdock/acp/IdeTerminalBridge.kt")
        include("agentdock/bridge/frontend/**")
        include("agentdock/settings/AudioCaptureManager.kt")
        include("agentdock/settings/WhisperFeatureManager.kt")
        include("agentdock/ui/**")
    }
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.frontend.xml")
    include("webview/**")
    include("fonts/**")
    include("icons/**")
    include("sounds/**")
}

tasks.named("processResources") {
    dependsOn(rootProject.tasks.named("npmBuild"))
}
