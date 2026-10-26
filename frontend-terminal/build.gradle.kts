plugins {
    id("org.jetbrains.intellij.platform.module")
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("rpc")
}

dependencies {
    intellijPlatform {
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
    implementation(project(":frontend"))
    implementation(project(":shared"))
}

kotlin {
    jvmToolchain(25)
    compilerOptions.freeCompilerArgs.add("-jvm-default=no-compatibility")
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.frontend-terminal.xml")
}
