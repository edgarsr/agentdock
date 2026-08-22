val embeddedLibraries by configurations.creating {
    isCanBeConsumed = false
}

configurations.named("compileOnly") {
    extendsFrom(embeddedLibraries)
}

dependencies {
    intellijPlatform {
        bundledModule("intellij.platform.backend")
        bundledModule("intellij.platform.kernel.backend")
        bundledModule("intellij.platform.rpc.backend")
        bundledModule("intellij.platform.vcs")
    }
    implementation(project(":shared"))
    // Regular implementation dependencies are packaged in the root plugin lib directory, which
    // is not visible to a Plugin Model v2 content-module classloader. Embed backend-only runtime
    // libraries in this module instead; shared serialization is provided by agent-dock.shared.
    embeddedLibraries("com.agentclientprotocol:acp:0.24.0") {
        exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-bom")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core-jvm")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-serialization-core")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-serialization-json")
    }
    embeddedLibraries("io.github.java-diff-utils:java-diff-utils:4.15")
    compileOnly("org.jetbrains.kotlinx:kotlinx-serialization-json-jvm:1.7.3")
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    testImplementation(kotlin("test-junit"))
}

kotlin {
    jvmToolchain(21)
    compilerOptions.freeCompilerArgs.add("-Xjvm-default=all")
    sourceSets["main"].kotlin.apply {
        srcDir(rootProject.layout.projectDirectory.dir("src/main/kotlin"))
        // Everything that touches JCEF, AWT, the microphone or the status bar belongs to the
        // frontend module; the terminal integration is its own optional module.
        exclude("agentdock/AddCodeReferenceToChatAction.kt")
        exclude("agentdock/AddFileReferenceToChatAction.kt")
        exclude("agentdock/AgentDockToolWindowFactory.kt")
        exclude("agentdock/AssetLoader.kt")
        exclude("agentdock/ExternalCodeReferenceDispatcher.kt")
        exclude("agentdock/gitcommit/GenerateGitCommitMessageAction.kt")
        exclude("agentdock/IdeTheme.kt")
        exclude("agentdock/JcefDragAndDropSupport.kt")
        exclude("agentdock/acp/AcpAudioPlayer.kt")
        exclude("agentdock/acp/IdeTerminalBridge.kt")
        exclude("agentdock/acp/IdeTerminalBridgeImpl.kt")
        exclude("agentdock/bridge/frontend/**")
        exclude("agentdock/settings/AudioCaptureManager.kt")
        exclude("agentdock/settings/WhisperFeatureManager.kt")
        exclude("agentdock/ui/**")
    }
    sourceSets["test"].kotlin.srcDir(rootProject.layout.projectDirectory.dir("src/test/kotlin"))
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.backend.xml")
    include("acp-adapters/**")
    include("icons/**")
    include("patches/**")
}

tasks.named<org.gradle.api.tasks.bundling.Jar>("jar") {
    duplicatesStrategy = org.gradle.api.file.DuplicatesStrategy.EXCLUDE
    from({
        embeddedLibraries.map { library ->
            if (library.isDirectory) library else zipTree(library)
        }
    })
    exclude(
        "META-INF/MANIFEST.MF",
        "META-INF/*.DSA",
        "META-INF/*.RSA",
        "META-INF/*.SF",
        "module-info.class",
        "META-INF/versions/**/module-info.class",
    )
}
