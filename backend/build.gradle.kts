plugins {
    id("org.jetbrains.intellij.platform.module")
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("rpc")
}

dependencies {
    intellijPlatform {
        bundledModule("intellij.platform.backend")
        bundledModule("intellij.platform.kernel.backend")
        bundledModule("intellij.platform.rpc.backend")
        bundledModule("intellij.platform.vcs")
        // ChangesListView, used by the commit message action, lives here rather than in the VCS API.
        bundledModule("intellij.platform.vcs.impl.shared")
    }
    implementation(project(":shared"))
    // Runtime copies are packaged as separate JARs in the root plugin lib directory. The
    // agent-dock.backend-libraries embedded module exposes that classpath to this content module.
    compileOnly("com.agentclientprotocol:acp:0.34.0") {
        exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-bom")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core-jvm")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-serialization-core")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-serialization-json")
    }
    compileOnly("io.github.java-diff-utils:java-diff-utils:4.15")
    compileOnly("org.jetbrains.kotlinx:kotlinx-serialization-json-jvm:1.8.1")
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    testImplementation(kotlin("test-junit"))
}

configurations.named("testCompileOnly") {
    extendsFrom(configurations.named("compileOnly").get())
}

configurations.named("testRuntimeOnly") {
    extendsFrom(configurations.named("compileOnly").get())
}

kotlin {
    jvmToolchain(25)
    // Everything that touches JCEF, AWT, the microphone or the status bar belongs to the
    // frontend module; the terminal integration is its own optional module.
    compilerOptions.freeCompilerArgs.add("-jvm-default=no-compatibility")
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.backend.xml")
    include("acp-adapters/**")
    include("icons/**")
    include("patches/**")
}
